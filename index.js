var _ = require('lodash');
var utils = require('utilities');

// Geddy Ember Serializer
//
// The Geddy Ember Serializer takes arbitrary Geddy output (models or arrays!)
// Loaded associations encouraged!
// Recursive, nested associations?  No problem!
//
// The Serializer will eat up your Geddy output, and give you a flat, side-loaded
// object ready to pass straight to an Ember Data user, and Ember Data will just
// eat it up and give them those models on the client side.
//
// I personally do a filter function on the Geddy output before passing it to the
// serializer, and that makes for some very easy filter-serialize logic!
//
// The Serializer works by first digesting chunks of data, any number, into its
// local "store", which is easy to turn into a side-loaded response.
//
// The store will have approximately this form:
//
//  store = {
//    Person:{1:{type:'Person', id:1, books:[1]}, {type:'Person', id:2, books:[]},
//    Book:{1:{type:'Book', id:1, author:1}}
//  };
//
//  It will then load all the records into a flat object with camelized, pluralized keys:
//
//  result = {
//    people: [{id:1, type:'Person', books:[1]}, {id:2, type:'Person', books:[]}],
//    books:  [{id:2, type:'Book', author: 1}]
//  };
//
//  Right now the serializer does NOT set up inverse hasMany relationships, or
//  `through` relationships, but it still seems to make Ember Data happy for now.

var store = {};

var reg, ModelBase;

module.exports = {

  // Methods:
  init:            init,       // Pass it Model at least once.
                               // Call it again whenever you want
                               // a fresh response.

  digest:          digest,     // Pass it a Model object or array,
                               // with some associations loaded on it.
                               //
                               // Recursion is fine!  This single object
                               // and its associations will be added
                               // to the store.

  serialize:       serialize, // Call serialize when you're ready
                              // to withdraw the serializer's store
                              // as a side-loaded object.
  getStore:        function (){
    return store;
  }
};

function init (model) {
  store = {};

  if( model){
    ModelBase = model.ModelBase;
    reg = model.descriptionRegistry;
  }
}

function digest (model){

  if(!model){
    throw new Error("Must provide the geddy registry and the model, not in that order!");
  }

  if( typeof model === 'object' ){
    if( Array.isArray( model ) ){

      model.forEach(function(one){
        addModelToStore( one );
      });

    } else {

      addModelToStore( model );
    }
  }

};

function serialize () {

  connectRelationships();
  var response = arrayize( store );
  response = uniqueIds( response );
  return response;

}

function uniqueIds( response ){

  for(var type in response){

    response[ type ].forEach( function (model) {
      for( var key in model ){
        if( Array.isArray( model[key] )){

          model[key] = _.uniq( model[key] );

        }
      }
    });
  }
  return response;
}

function pluralize (relationName) {
  var plural = utils.inflection.pluralize( relationName );
  var camelized = utils.string.camelize( plural );
  return camelized;
}

function connectRelationships () {

  var types = Object.keys( store );

  for( var type in store ){
    var description = reg[ type ];

    for( var relationTypeName in description.associations ){
      var relationType = description.associations[ relationTypeName ];

      for( var relationName in relationType ){
        var relation = relationType[ relationName ];

        if( types.indexOf( relation.model ) !== -1){

          for( var id in store[ type ]){
            var model = store[ type ][ id ];
            addPluralAssociationsToModel( model, relation);
            addSingularAssociationsToModel( model, relation);
            addManyToManyAssociationsToModel( model, relation );
            addManyToManyThroughAssociationsToModel( model, relation );
          }
        }
      }
    }
  }
}

function addManyToManyThroughAssociationsToModel( model, relation ){
  if (relation.through && relation.type === 'hasMany'){
    for( var modelId in store[ model.type ] ){
      var model = store[ model.type ][ modelId ];
      var otherKey = pluralize( relation.name );
      var localArray = model[ otherKey ];

      // Find opposing models and synchronize them:
      var inverseKey = inversePluralKeyForRelation( relation, model.type );

      // First add OUR relations to the related arrays:
      localArray.forEach( function (otherId) {
        var other = store[ relation.model ][ otherId ];

        if( other[ inverseKey ].indexOf( model.id ) === -1 ){
          other[ inverseKey ].push( model.id );
        }
      });

      // Then we'll add THEIR relations to OUR related array:
      for(var candidateId in store[ relation.model ]){
        var candidate = store[ relation.model ][ candidateId ];

        // If we are in their array:
        if ( candidate[ inverseKey ] &&
          candidate[ inverseKey ].indexOf( model.id ) !== -1){
          localArray.push( candidate.id );
        }
      }
      model[ otherKey ] = localArray;
    }
  }
}

function addManyToManyAssociationsToModel( model, relation ){

  if( relation.type !== 'hasMany'){
    return;
  }

  var parentId = model.id;
  var modelType = relation.model;
  var through   = relation.through;

  var pluralKey = pluralize( relation.name );

  var inverseKey = inversePluralKeyForRelation( relation, model.type );
  if (inverseKey) {

    for( var candidateId in store[ modelType ]) {
      var candidate = store[ modelType ][ candidateId ];

      var contains = candidate[ inverseKey ].indexOf( parentId ) !== -1;

      candidate[ inverseKey ].forEach( function (maybeParent, i, arr){
        if (maybeParent.id && maybeParent.id === parentId) {
          contains = true;
          arr[i] = maybeParent.id;
          return false;
        }
      });

      if( contains ){
        model[ pluralKey ].push( candidateId );
      }

    }
  }
}

// Takes a model and a relation descriptor for one of its associations
// Finds models matching the relation's type,
// who have an inverse PLURAL key pointing at the model,
// and adds their ID to the model's `singularKey` attribute.
function addPluralAssociationsToModel( model, relation ) {

  if (relation.type !== 'belongsTo'){
    return;
  }

  var childId = model.id;
  var modelType = relation.model;
  var through   = relation.through;

  var singularKey = utils.string.camelize( relation.name ) + 'Id';

  var inverseKey = inversePluralKeyForRelation( relation, model.type );

  if (inverseKey) {
    for( var candidateId in store[ modelType ] ){

      if (parseInt( candidateId ) === parseInt( model[ singularKey ])) {
        var candidate = store[ modelType ][ candidateId ];

        if( Array.isArray( candidate[ inverseKey ] ) ){
          candidate[ inverseKey ].push( parseInt(childId) );
        } else {
          candidate[ inverseKey ] = [ parseInt(childId) ];
        }
      }
    }
  }
}

// Takes a model and a relation descriptor for one of its associations
// Finds models matching the relation's type,
// who have an inverse SINGULAR key pointing at the model,
// and adds their ID to the model's array named after that relation,
// pluralized.
function addSingularAssociationsToModel (model, relation) {

  if( relation.type !== 'hasMany'){
    return;
  }

  var parentId = model.id;

  // What we'd call the array on the parent model:
  var pluralKey = pluralize( relation.name );

  // Details of the relation:
  var modelType = relation.model;
  var through   = relation.through;

  // What we'd call the parent on the relation object:
  var inverseKey = inverseSingularKeyForRelation( relation, model.type );

  // If an inverse singular key was found, add it to the models:
  if (inverseKey) {

    for( var candidateId in store[ modelType ] ){
      var candidate = store[ modelType ][ candidateId ];

      if( candidate[ inverseKey ] === parentId ){
        model[ pluralKey ].push( candidateId );
      }
    }
  }
}

// Pass a relation object and the kind model it is from.
// Find the related object's relation object.
// If it is a hasMany and has a matching through:
// Get back the inverse model's key, pluralized.
function inversePluralKeyForRelation (relation, type) {

  var desc = reg[ relation.model ];
  var hasMany = desc.associations.hasMany;

  var result;
  for (var relationName in hasMany) {
    var candidate = hasMany[ relationName ];

    // Only accepts hasMany relations & matching through:
    if( candidate.model === type && candidate.type === 'hasMany' &&
        candidate.through === relation.through ){
      result = pluralize( relationName );
    }
  }

  return result;
}

// Pass a relation object and the kind model it is for
// If it matches a belongsTo,
// Get back the inverse model's key:
function inverseSingularKeyForRelation (relation, type) {

  var desc = reg[ relation.model ];
  var belongsTo = desc.associations.belongsTo;

  var result;

  for (var relationName in belongsTo) {
    var candidate = belongsTo[ relationName ];

    // Only accepts belongsTo relations:
    if( candidate.model === type && candidate.type === 'belongsTo'){
      result = utils.string.camelize( relationName );
    }
  }

  return result;
}

function findTypeThatBelongsToThis (type, parent) {

  var reg = reg[ type ].associations.belongsTo;

}

function arrayize (store) {
  var response = {};

  for(var ModelName in store){
    var plural = utils.inflection.pluralize( ModelName );
    var camelized = utils.string.camelize( plural );
    response[ camelized ] = [];

    for( var id in store[ ModelName ] ){
      response[ camelized ].push( store[ ModelName ][id] );
    }
  }
  return response;
}


function addModelToStore (model) {

  var type = model.type;
  var desc = reg[type];

  var latest = pullLatest( model );
  latest = updateLatest( latest, model );

  store[ type ][ model.id ] = latest;
}

function pullLatest (model) {
  var type = model.type;
  var id   = model.id;

  if (!store[ type ]) {
    store[ type ] = {};
  }

  var latest;

  if (store[ type ][ id ]){
    latest = store [ type ][ id ];
  } else {

    // Initialize a model and return it:
    latest = model.toJSON();
    for( var associationName in reg[ type ].associations.hasMany ) {
      var assocKey = utils.inflection.pluralize( associationName );
      assocKey = utils.string.camelize( assocKey );
      latest[ assocKey ] = [];
    }

  }
  return latest;
}

function updateLatest( latest, model ){
  var type = model.type;
  var desc = reg[type];

  // Copy over properties
  for (var prop in desc.properties) {
    latest[ prop ] = model[ prop ];
  }
  // Find relationships
  for (var key in model) {
    if (typeof latest[key] === 'object' &&
      // Is not a property:
      !desc.properties[ key ]){

      // If it's an array, it's a hasMany:
      if( Array.isArray( latest[key] )){
        // Add the members to the store:
        model[key].forEach(function(obj){
          addModelToStore( obj );
        });

        // Add their IDs to the latest object's array:
        if( model[key] ){
          model[key].forEach(function(obj){
            latest[key].push( parseInt(obj.id) );
          });
        }

      // If it's another model itself:
      } else {
        addModelToStore( model[key] );
        latest[ key ] = model[ key ].id;
      }
    }
  }
  return latest;
}

// Needs to return true or false based on whether a model is a valid
// geddy model object.
function isAModel( model ){
//  return (model instanceof ModelBase);
  var isAModel = (typeof model === 'object');
  return isAModel;
}
