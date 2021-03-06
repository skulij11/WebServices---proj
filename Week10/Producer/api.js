const express = require("express");
const app = express();
const entities = require("./entities");
const bodyparser = require('body-parser');
const uuid = require("node-uuid");
const producer = require("./producer");

const adminToken = "admin";

app.use(bodyparser.json());

app.get("/companies", (req, res) => {
    // Gets all companies that have been registered to the MongoDBh
    entities.Company.find(function(err, docs) {
        if(err) {
            res.status(500).send(err);
        } else {
            console.log(docs);
            res.json(docs);
        }
    })
});

app.get("/companies/:id", (req, res) => {
    // Gets the required company from MongoDB by its ID
    var query = {
        _id: req.params.id
    };
    entities.Company.find(query, function(err, docs) {
        console.log(docs);
        if(err) {
            res.status(500).send(err);
        } else {
            if(docs.length === 0) {
                // If the company is not found - 404
                res.status(404).send("Company not found");
            }
            else {
                res.json(docs);
            }
        }
    })
});

app.post("/companies", (req, res) => {
    // Used to add new companies to the database from the request body. Admin authenitcation requried using Authorization header.
    if(req.headers.authorization !== adminToken) {
        // If admin token is missing/incorrect - 401
        res.status(401).send("Not authorized");
        return;
    }

    var data = {
        name: req.body.name
    };
    if(req.body.punchCount) {
        data.punchCount = req.body.punchCount;
    }

    var entity = new entities.Company(data);
    entity.save(function(err) {
        if(err) {
            // If payload not valid - 412
            res.status(412).send("Fields invalid/missing");
            return;
        } else {
            // New company added -201
            res.status(201).json({
                _id: entity._id,
            });
            return;
        }
    })
});


app.get("/users", (req, res) => {
// Returns a list of all users in the database
    entities.User.find(function(err, users) {
        if(err) {
            res.status(500).send(err);
        } else {
            var userList = [];
            // Used to remove token field from docs
            users.forEach(function(user) {
                userList.push({
                    _id: user._id,
                    name: user.name,
                    gender: user.gender
                });
            });
            console.log(userList);
            res.json(userList);
        }
    })
});


app.post("/users", (req, res) => {
    // Used to add new user to the database. Admin authentication required.
    if(req.headers.authorization !== adminToken) {
        res.status(401).send("Not authorized");
        return;
    }

    var data = {
        name: req.body.name,
        gender: req.body.gender,
        token: uuid.v1(),
    };
    console.log(data);

    var entity = new entities.User(data);
    entity.save(function(err) {
        if(err) {
            res.status(412).send("Fields invalid/missing");
            return;
        } else {
            res.status(201).send({
                _id: entity._id,
                token: data.token
            });
            producer.sendToConsumer("user.add", {
                id: entity._id, name: entity.name, 
                gender: entity.gender, date: new Date()});
            return;
        }
    })
});

app.get("/my/punches", (req, res) => {

    // Used to check all punches for an authorized user
    const token = req.headers.authorization;
   
    var query = {
        token: token
    }
    var user_id;
    var user = entities.User.find(query, function(err, user) {
        if(err) {
            res.status(500).send(err);
        } else {
            if(user.length !== 1) {
                res.status(401).send("User authorization not found");
                return;
            } else {
                console.log(user);
                entities.Punch.find({"user_id": user[0]._id}, function(err, punches) {
                    if(err) {
                        res.status(500).send(err);
                    } else {
                        console.log("Count: ", punches.length);
                        console.log(punches);
                        res.json(punches);
                    }
                });        
            }
        }
    });
});


app.post("/my/punches", (req, res) => {
    // Creates a new punch for the current (authenticated) user for a given company
    // User token used to authenticate
    const token = req.headers.authorization;

    // Check if the company_id field is in the req body:
    console.log(req.body.company_id);
    if(!req.body.company_id) {
        console.log("Company id not found");
        res.status(400).send("Company id not found");
        return;
    }

    var userQuery = {
        token: token
    }
    // Check for the authenticated user using the token, if he is not found - 401
    var user = entities.User.find(userQuery, function(err, user) {
        if(err) {
            res.status(500).send(err);
            return;
        }
        if(user.length !== 1) {
            res.status(401).send("User authorization not found");
            return;
        } else {
            console.log(user);

            var compQuery = {
                _id: req.body.company_id
            }
            // Check for the company using the company_id from body.
            // If not found - 404
            var company = entities.Company.find(compQuery, function(err, comp) {
                if(err) {
                    res.status(500).send(err);
                } else {
                    if(comp.length !== 1) {
                        res.status(404).send("Company not found");
                    }
                    else {
                        console.log(comp);

                        // Now we create a new punch using the user_id and company_id from before
                        var data = {
                            user_id: user[0]._id,
                            company_id: req.body.company_id,
                        }    

                        var punch = new entities.Punch(data);
                        console.log(punch);

                        punch.save(function(err) { 
                            if(err) {
                                res.status(412).send("Fields invalid/missing");
                                return;
                            } else {
                                // Find all other similar punches
                                var punchQuery = {
                                    "user_id": punch.user_id, 
                                    "company_id": punch.company_id, 
                                    "used": false
                                };
                                var others = entities.Punch.find(punchQuery, function(err, punches) {
                                    if(err) {
                                        res.status(500).send(err);
                                        return;
                                    }
                                    else {
                                        // If number of punches is equal to punchCount, change "used" to "true" and return discount
                                        console.log("\nList of punches:");
                                        console.log(punches);
                                        //console.log("PC:", comp[0].punchCount);

                                        if(punches.length === comp[0].punchCount) {
                                            punches.forEach(function(p) {
                                                p.used = true;
                                                p.save();
                                            });
                                            console.log("Discount!");
                                            res.status(201).json({discount: true}); 
                                            console.log("Comp:", comp[0]);
                                            producer.sendToConsumer("punch.discount", 
                                                {user_id: user[0]._id, user_name: user[0].name, 
                                                    comp_id: comp[0]._id, comp_name: comp[0].name, comp_punchcount: comp[0].punchCount, date: new Date()});
                                            return;               
                                        }
                                        else {
                                            //console.log(punches.length);
                                            res.status(201).json({_id: punch._id});
                                            producer.sendToConsumer("punch.add", 
                                                {user_id: user[0]._id, user_name: user[0].name, 
                                                    comp_id: comp[0]._id, comp_name: comp[0].name, comp_punchcount: comp[0].punchCount,  date: new Date(), unused: punches.length});
                                            return;
                                        }
                                    }
                                })
                            }
                        })
                            
                    }
                }
            });
        }
    });
})


module.exports = app;