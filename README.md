# Geddy Ember Serializer

## Geddy and Ember.js Play Together!

If you're using the [Model](https://github.com/geddy/model) ORM, you may be using the [Geddy](geddyjs.org) framework.  You also might be using it on its own!

Geddy has some great nested object retrieval, but Ember-Data requires slightly differently structured data.  This module creates a bridge between the two data structures.


```javascript
  var serializer = require('geddy-model-serializer');

  // You must call init at least once, passing in a Model instance,
  // with your schema loaded into it:
  serializer.init( geddy.model );

  geddy.model.User.first({}, { includes: 'Books' }, function (err, user){
    if (err) throw err;

    /* Model returns nested relationships in a format like this:

    var user === {
      id: 1,
      name: "Joe Schmoe",
      books: [
        {
          id:54,
          title: "Huck Finn"
        },
        {
          id:99,
          title: "The Peripheral"
        }
      ]
    };

    */


    /* With this module, we can structure the same data like this: */
    serizer.digest( user ); // Feed it as many models as you want, with relationships loaded!
    var result = serializer.serialize(); // Does the actual conversion on this function call:
    console.dir( result );

    /* Result would look like this:

      var result = {
        users:[
          {
            id: 1,
            name: "Joe Schmoe",
            books: [54, 99]
          }
        ],

        books:[
          {
            id:54,
            title: "Huck Finn"
          },
          {
            id:99,
            title: "The Peripheral"
          }
        ]
      }

    */
  });
}
```
