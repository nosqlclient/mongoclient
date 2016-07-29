/**
 * Created by RSercan on 5.3.2016.
 */

Meteor.methods({
    'listCollectionNames': function (dbName) {
        LOGGER.info('[listCollectionNames]', dbName);

        return Async.runSync(function (done) {
            try {
                var wishedDB = database.db(dbName);
                wishedDB.listCollections().toArray(function (err, collections) {
                    done(err, collections);
                });

            }
            catch (ex) {
                LOGGER.error('[listCollectionNames]', ex);
                done(new Meteor.Error(ex.message), null);
            }
        });

    },

    'getDatabases': function () {
        LOGGER.info('[getDatabases]');

        return Async.runSync(function (done) {
            try {
                database.admin().listDatabases(function (err, dbs) {
                    done(err, dbs.databases);
                });
            }
            catch (ex) {
                LOGGER.error('[getDatabases]', ex);
                done(new Meteor.Error(ex.message), null);
            }
        });
    },

    'disconnect': function () {
        if (database) {
            database.close();
        }
    },

    'connect': function (connectionId) {
        var connection = Connections.findOne({_id: connectionId});
        var connectionUrl = getConnectionUrl(connection);
        var connectionOptions = getConnectionOptions(connection);

        LOGGER.info('[connect]', connectionUrl, clearConnectionOptionsForLog(connectionOptions));

        return Async.runSync(function (done) {
            if (connection.sshAddress) {
                var config = {
                    dstPort: connection.port,
                    host: connection.sshAddress,
                    port: connection.sshPort,
                    username: connection.sshUser
                };

                if (connection.sshCertificate) {
                    config.privateKey = new Buffer( connection.sshCertificate );
                }

                if (connection.sshPassPhrase) {
                    config.passphrase = connection.sshPassPhrase;
                }

                if (connection.sshPassword) {
                    config.password = connection.sshPassword;
                }

                var tunnelSsh = new require('tunnel-ssh');
                tunnelSsh(config, function (error) {
                    if (error) {
                        done(new Meteor.Error(error.message), null);
                        return;
                    }
                    proceedConnectingMongodb(connectionUrl, connectionOptions, done);
                });
            } else {
                proceedConnectingMongodb(connectionUrl, connectionOptions, done);
            }
        });
    },

    'dropDB': function () {
        LOGGER.info('[dropDatabase]');

        return Async.runSync(function (done) {
            try {
                database.dropDatabase(function (err, result) {
                    done(err, result);
                });
            }
            catch (ex) {
                LOGGER.error('[dropDatabase]', ex);
                done(new Meteor.Error(ex.message), null);
            }
        });
    },

    'dropCollection': function (collectionName) {
        LOGGER.info('[dropCollection]', collectionName);

        return Async.runSync(function (done) {
            try {
                var collection = database.collection(collectionName);
                collection.drop(function (dropError) {
                    done(dropError, null);
                });
            }
            catch (ex) {
                LOGGER.error('[dropCollection]', ex);
                done(new Meteor.Error(ex.message), null);
            }
        });
    },

    'dropAllCollections': function () {

        return Async.runSync(function (done) {
            try {
                database.collections(function (err, collections) {
                    collections.forEach(function (collection) {
                        if (!collection.collectionName.startsWith('system')) {
                            collection.drop(function (dropError) {
                            });
                        }
                    });

                    done(err, {});
                });
            }
            catch (ex) {
                LOGGER.error('[dropAllCollections]', ex);
                done(new Meteor.Error(ex.message), null);
            }
        });
    },

    'createCollection': function (collectionName, options) {
        LOGGER.info('[createCollection]', collectionName, options);

        return Async.runSync(function (done) {
            try {
                database.createCollection(collectionName, options, function (err, result) {
                    done(err, null);
                });
            }
            catch (ex) {
                LOGGER.error('[createCollection]', ex);
                done(new Meteor.Error(ex.message), null);
            }
        });
    }
});

var proceedConnectingMongodb = function (connectionUrl, connectionOptions, done) {
    var mongodbApi = require('mongodb').MongoClient;

    if (!connectionOptions) {
        connectionOptions = {};
    }

    connectionOptions.uri_decode_auth = true;

    mongodbApi.connect(connectionUrl, connectionOptions, function (mainError, db) {
        if (mainError || db == null || db == undefined) {
            LOGGER.error(mainError, db);
            done(mainError, db);
            if (db) {
                db.close();
            }
            return;
        }
        try {
            database = db;
            database.listCollections().toArray(function (err, collections) {
                done(err, collections);
            });
        }
        catch (ex) {
            LOGGER.error('[connect]', ex);
            done(new Meteor.Error(ex.message), null);
            if (db) {
                db.close();
            }
        }
    });
};

