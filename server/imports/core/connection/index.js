/* eslint-disable nonblock-statement-body-position */
import { Database, Logger, Error } from '/server/imports/modules';
import ConnectionHelper from './helper';

const fs = require('fs');
const mongodbUrlParser = require('mongodb-url');
const jsonParser = require('json5');

const Connection = function () {};

const addSSLOptions = function (obj, result) {
  if (obj.rootCAFile) {
    result.sslValidate = true;
    result.sslCA = Buffer.from(obj.rootCAFile);
  }
  if (obj.certificateFile) result.sslCert = Buffer.from(obj.certificateFile);
  if (obj.certificateKeyFile) {
    result.sslKey = Buffer.from(obj.certificateKeyFile);
  }
  if (obj.passPhrase) result.sslPass = obj.passPhrase;
  if (obj.disableHostnameVerification) result.checkServerIdentity = false;
};

const setOptionsToConnectionFromParsedUrl = function (connection, parsedUrl) {
  if (parsedUrl.server_options) {
    connection.options.connectionTimeout =
      parsedUrl.server_options.socketOptions &&
      parsedUrl.server_options.socketOptions.connectTimeoutMS
        ? parsedUrl.server_options.socketOptions.connectTimeoutMS
        : '';
    connection.options.socketTimeout =
      parsedUrl.server_options.socketOptions &&
      parsedUrl.server_options.socketOptions.socketTimeoutMS
        ? parsedUrl.server_options.socketOptions.socketTimeoutMS
        : '';
    connection.ssl.enabled = !!parsedUrl.server_options.ssl;
  }

  connection.options.replicaSetName =
    parsedUrl.rs_options && parsedUrl.rs_options.rs_name
      ? parsedUrl.rs_options.rs_name
      : '';
  connection.options.readPreference = parsedUrl.db_options.read_preference;
};

const setAuthToConnectionFromParsedUrl = function (connection, parsedUrl) {
  connection.authenticationType = parsedUrl.db_options.authMechanism
    ? parsedUrl.db_options.authMechanism
        .toLowerCase()
        .replace(new RegExp('-', 'g'), '_')
    : '';
  if (connection.authenticationType) {
    connection[connection.authenticationType] = {};
  }
  if (
    parsedUrl.db_options.gssapiServiceName &&
    connection.authenticationType === 'gssapi'
  ) {
    connection.gssapi.serviceName = parsedUrl.db_options.gssapiServiceName;
  }
  if (connection.authenticationType === 'mongodb_x509') delete connection.ssl;

  if (parsedUrl.auth) {
    // if auth exists there should be an authentication, even there's no authMechanism set
    connection.authenticationType =
      connection.authenticationType || 'scram_sha_1';
    connection[connection.authenticationType] =
      connection[connection.authenticationType] || {};
    connection[connection.authenticationType].username = parsedUrl.auth.user
      ? parsedUrl.auth.user
      : '';
    connection[connection.authenticationType].password = parsedUrl.auth.password
      ? parsedUrl.auth.password
      : '';
  }
  if (
    connection.authenticationType === 'mongodb_cr' ||
    connection.authenticationType === 'scram_sha_1' ||
    connection.authenticationType === 'scram_sha_256'
  ) {
    connection[connection.authenticationType].authSource = parsedUrl.db_options
      .authSource
      ? parsedUrl.db_options.authSource
      : connection.databaseName;
  }
};

const checkAuthenticationOfConnection = function (connection) {
  if (connection.authenticationType !== 'scram_sha_1') {
    delete connection.scram_sha_1;
  }
  if (connection.authenticationType !== 'scram_sha_256') {
    delete connection.scram_sha_256;
  }
  if (connection.authenticationType !== 'mongodb_cr') {
    delete connection.mongodb_cr;
  }
  if (connection.authenticationType !== 'mongodb_x509') {
    delete connection.mongodb_x509;
  }
  if (connection.authenticationType !== 'gssapi') delete connection.gssapi;
  if (connection.authenticationType !== 'plain') delete connection.plain;

  if (connection.mongodb_x509) delete connection.ssl;
  if (connection.ssl && !connection.ssl.enabled) delete connection.ssl;
  if (connection.gssapi && !connection.gssapi.serviceName) {
    Error.create({
      type: Error.types.MissingParameter,
      formatters: ['service-name', 'gssapi'],
      metadataToLog: connection,
    });
  }
};

const checkSSHOfConnection = function (connection) {
  if (connection.ssh) {
    if (!connection.ssh.enabled) delete connection.ssh;
    if (!connection.ssh.destinationPort) {
      Error.create({
        type: Error.types.MissingParameter,
        formatters: ['destination-port', 'ssh'],
        metadataToLog: connection,
      });
    }
    if (!connection.ssh.username) {
      Error.create({
        type: Error.types.MissingParameter,
        formatters: ['username', 'ssh'],
        metadataToLog: connection,
      });
    }
    if (!connection.ssh.host) {
      Error.create({
        type: Error.types.MissingParameter,
        formatters: ['host', 'ssh'],
        metadataToLog: connection,
      });
    }
    if (!connection.ssh.port) {
      Error.create({
        type: Error.types.MissingParameter,
        formatters: ['port', 'ssh'],
        metadataToLog: connection,
      });
    }
    if (!connection.ssh.certificateFileName && !connection.ssh.password) {
      Error.create({
        type: Error.types.MissingParameter,
        formatters: ['certificate-or-password', 'ssh'],
        metadataToLog: connection,
      });
    }
  }
};

const migrateSSHPart = function (oldConnection, connection) {
  if (oldConnection.sshAddress) {
    connection.ssh = {
      enabled: true,
      host: oldConnection.sshAddress,
      port: oldConnection.sshPort,
      username: oldConnection.sshUser,
      destinationPort: oldConnection.sshPort,
    };

    if (oldConnection.sshPassword) {
      connection.ssh.password = oldConnection.sshPassword;
    } else {
      connection.ssh.certificateFile = oldConnection.sshCertificate;
      connection.ssh.certificateFileName = oldConnection.sshCertificatePath;
      connection.ssh.passPhrase = oldConnection.sshPassPhrase;
    }
  }
};

const migrateSSLPart = function (oldConnection, connection) {
  if (oldConnection.sslCertificatePath) {
    const objToChange = oldConnection.x509Username
      ? connection.mongodb_x509
      : connection.ssl;
    objToChange.certificateFile = oldConnection.sslCertificate;
    objToChange.certificateFileName = oldConnection.sslCertificatePath;
    objToChange.passPhrase = oldConnection.passPhrase;
    if (oldConnection.rootCACertificatePath) {
      objToChange.rootCAFile = oldConnection.rootCACertificate;
      objToChange.rootCAFileName = oldConnection.rootCACertificatePath;
    }
    if (oldConnection.certificateKeyPath) {
      objToChange.certificateKeyFile = oldConnection.certificateKey;
      objToChange.certificateKeyFileName = oldConnection.certificateKeyPath;
    }
  }
};

const getRoundedMilisecondsFromSeconds = function (sec) {
  if (sec) return Math.round(sec * 100 * 1000) / 100;
  return '30000';
};

Connection.prototype = {
  importConnections(file) {
    Logger.info({
      message: 'import-mongoclient-connections',
      metadataToLog: { file },
    });

    try {
      const mongoclientData = JSON.parse(file);
      if (mongoclientData.connections) {
        for (let i = 0; i < mongoclientData.connections.length; i += 1) {
          delete mongoclientData.connections[i]._id;
          Database.insert({
            type: Database.types.Connections,
            document: mongoclientData.connections[i],
          });
        }
        this.migrateConnectionsIfExist();
      }
    } catch (exception) {
      Error.create({
        type: Error.types.InternalError,
        externalError: exception,
        metadataToLog: file,
      });
    }
  },

  save(connection) {
    Logger.info({ message: 'save-connection', metadataToLog: { connection } });
    if (connection._id) {
      Database.remove({
        type: Database.types.Connections,
        selector: { _id: connection._id },
      });
    }

    Database.create({ type: Database.types.Connections, document: connection });
  },

  checkAndClear(connection) {
    Logger.info({ message: 'check-connection', metadataToLog: { connection } });
    if (connection.url) connection = this.parseUrl(connection);

    if (connection.servers.length === 0) {
      Error.create({
        type: Error.types.MissingParameter,
        formatters: ['one-server', 'servers'],
      });
    }
    connection.servers.forEach((server) => {
      if (!server.host || !server.port) {
        Error.create({
          type: Error.types.MissingParameter,
          formatters: ['host-and-port', 'server'],
        });
      }
    });

    checkAuthenticationOfConnection(connection);
    checkSSHOfConnection(connection);
  },

  parseUrl(connection) {
    try {
      Logger.info({ message: 'parse-url', metadataToLog: { connection } });

      const parsedUrl = mongodbUrlParser(connection.url);
      connection.options = connection.options || {};
      connection.ssl = connection.ssl || {};
      connection.databaseName = parsedUrl.dbName || 'admin';
      connection.servers = parsedUrl.servers;

      Logger.info({ message: 'parsed-url', metadataToLog: { parsedUrl } });

      setOptionsToConnectionFromParsedUrl(connection, parsedUrl);
      setAuthToConnectionFromParsedUrl(connection, parsedUrl);

      return connection;
    } catch (exception) {
      Error.create({
        type: Error.types.ParseUrlError,
        externalError: exception,
        metadataToLog: connection,
      });
    }
  },

  remove(connectionId) {
    Logger.info({
      message: 'remove-connection',
      metadataToLog: { connectionId },
    });
    Database.remove({
      type: Database.types.Connections,
      selector: { _id: connectionId },
    });
    Database.remove({
      type: Database.types.QueryHistory,
      selector: { _id: connectionId },
    });
  },

  /* Migrates 1.x version connections to 2.x */
  migrateConnectionsIfExist() {
    Logger.info({ message: 'migrate-connections' });

    const settings = Database.readOne({
      type: Database.types.Settings,
      query: {},
    });
    if (settings.isMigrationDone) return;

    const connectionsAfterMigration = [];

    Database.read({ type: Database.types.Connections }).forEach(
      (oldConnection) => {
        // if there's a name (was mandatory) property it's old.
        if (oldConnection.name) {
          let connection = { options: {} };
          if (oldConnection.url) {
            connection = this.parseUrl({ url: oldConnection.url });
            connection.url = oldConnection.url;
          }

          connection._id = oldConnection._id;
          connection.connectionName = oldConnection.name;

          migrateSSHPart(oldConnection, connection);

          if (oldConnection.host && oldConnection.port) {
            connection.servers = [
              {
                host: oldConnection.host,
                port: oldConnection.port,
              },
            ];
          }
          if (oldConnection.readFromSecondary) {
            connection.options.readPreference = 'secondary';
          } else connection.options.readPreference = 'primary';

          if (oldConnection.databaseName) {
            connection.databaseName = oldConnection.databaseName;
          }
          if (oldConnection.user && oldConnection.password) {
            connection.scram_sha_1 = {
              username: oldConnection.user,
              password: oldConnection.password,
            };
            if (oldConnection.authDatabaseName) {
              connection.scram_sha_1.authSource =
                oldConnection.authDatabaseName;
            }
            connection.authenticationType = 'scram_sha_1';
          }

          if (oldConnection.useSsl || oldConnection.sslCertificatePath) {
            connection.ssl = { enabled: true };
          }

          if (oldConnection.x509Username) {
            connection.authenticationType = 'mongodb_x509';
            connection.mongodb_x509 = { username: oldConnection.x509Username };
            delete connection.ssl;
          }

          migrateSSLPart(oldConnection, connection);

          connectionsAfterMigration.push(connection);
        }
      }
    );

    Database.remove({ type: Database.types.Connections });
    connectionsAfterMigration.forEach((conn) =>
      Database.create({ type: Database.types.Connections, document: conn })
    );
    Database.update({
      type: Database.types.Settings,
      selector: {},
      modifier: { $set: { isMigrationDone: true } },
    });
  },

  tryInjectDefaultConnection() {
    const DEFAULT_CONNECTION_NAME = 'Default (preconfigured)';
    const defaultConnection = process.env.MONGOCLIENT_DEFAULT_CONNECTION_URL;
    if (!defaultConnection) return;

    Logger.info({
      message: 'inject-default-connection',
      metadataToLog: { defaultConnection },
    });
    const connection = this.parseUrl({ url: defaultConnection });
    connection.url = defaultConnection;
    connection.connectionName = DEFAULT_CONNECTION_NAME;

    // delete existing connection after we parsed the new one
    const existingConnection = Database.readOne({
      type: Database.types.Connections,
      query: { connectionName: DEFAULT_CONNECTION_NAME },
    });
    if (existingConnection) {
      Database.remove({
        type: Database.types.Connections,
        selector: { _id: existingConnection._id },
      });
      connection._id = existingConnection._id;
    }

    Database.create({ type: Database.types.Connections, document: connection });
  },

  savePredefinedConnections() {
    const filePath = process.env.MONGOCLIENT_CONNECTIONS_FILE_PATH;
    if (!filePath || !fs.existsSync(filePath)) return;

    const fileContent = fs.readFileSync(filePath, 'utf8');
    if (!fileContent || fileContent.replace(/\s/g, '').length === 0) return;

    Logger.info({
      message: 'predefined-connections',
      metadataToLog: { connections: fileContent },
    });

    try {
      const connections = jsonParser.parse(fileContent);
      if (Array.isArray(connections) && connections.length > 0) {
        // clear existing connections
        Database.remove({ type: Database.types.Connections, selector: {} });

        // insert new connection URLs.
        connections.forEach((connectionObj) => {
          Logger.info({
            message: 'import-predefined-connection',
            metadataToLog: { connection: connectionObj },
          });
          const connection = this.parseUrl({ url: connectionObj.url });
          connection.url = connectionObj.url;
          connection.connectionName = connectionObj.name;

          Database.create({
            type: Database.types.Connections,
            document: connection,
          });
        });
      }
    } catch (exception) {
      Logger.error({
        message: 'predefined-connections',
        metadataToLog: { exception },
      });
    }
  },

  getConnectionUrl(connection, username, password, addAuthSource, keepDB) {
    const connectionDb = connection.databaseName;
    Logger.info({
      message: `Connection DB: ${connectionDb}`,
    });
    if (connection.url) {
      if (username || password) {
        ConnectionHelper.changeUsernameAndPasswordFromConnectionUrl(
          connection,
          username,
          password
        );
      }
      if (!keepDB) ConnectionHelper.extractDBFromConnectionUrl(connection);
      else ConnectionHelper.putCorrectDBToConnectionUrl(connection);
      if (addAuthSource) {
        ConnectionHelper.addAuthSourceToConnectionUrl(connection);
      }

      return connection.url;
    }

    const settings = Database.readOne({
      type: Database.types.Settings,
      query: {},
    });

    // url
    let connectionUrl = 'mongodb://';
    if (connection.authenticationType) {
      if (username) connectionUrl += encodeURIComponent(username);
      else if (connection[connection.authenticationType].username) {
        connectionUrl += encodeURIComponent(
          connection[connection.authenticationType].username
        );
      }

      if (password) connectionUrl += `:${encodeURIComponent(password)}`;
      else if (connection[connection.authenticationType].password) {
        connectionUrl += `:${encodeURIComponent(
          connection[connection.authenticationType].password
        )}`;
      }

      connectionUrl += '@';
    }
    connection.servers.forEach((server) => {
      connectionUrl += `${encodeURIComponent(server.host)}:${server.port},`;
    });

    if (connectionUrl.endsWith(',')) {
      connectionUrl = connectionUrl.substring(0, connectionUrl.length - 1);
    }
    connectionUrl += '/';
    if (keepDB) connectionUrl += connection.databaseName;

    // options
    if (
      connection.authenticationType === 'mongodb_cr' ||
      connection.authenticationType === 'scram_sha_1' ||
      connection.authenticationType === 'scram_sha_256'
    ) {
      connectionUrl += ConnectionHelper.addOptionToUrl(
        connectionUrl,
        'authSource',
        connection[connection.authenticationType].authSource
      );
    } else if (connection.authenticationType === 'mongodb_x509') {
      connectionUrl += ConnectionHelper.addOptionToUrl(
        connectionUrl,
        'ssl',
        'true'
      );
    } else if (
      connection.authenticationType === 'gssapi' ||
      connection.authenticationType === 'plain'
    ) {
      if (connection.authenticationType === 'gssapi') {
        connectionUrl += ConnectionHelper.addOptionToUrl(
          connectionUrl,
          'gssapiServiceName',
          connection.gssapi.serviceName
        );
      }
      connectionUrl += ConnectionHelper.addOptionToUrl(
        connectionUrl,
        'authSource',
        '$external'
      );
    }

    if (connection.options) {
      if (connection.options.readPreference) {
        connectionUrl += ConnectionHelper.addOptionToUrl(
          connectionUrl,
          'readPreference',
          connection.options.readPreference
        );
      }

      if (connection.options.connectionTimeout) {
        connectionUrl += ConnectionHelper.addOptionToUrl(
          connectionUrl,
          'connectTimeoutMS',
          getRoundedMilisecondsFromSeconds(connection.options.connectionTimeout)
        );
      } else {
        connectionUrl += ConnectionHelper.addOptionToUrl(
          connectionUrl,
          'connectTimeoutMS',
          getRoundedMilisecondsFromSeconds(settings.connectionTimeoutInSeconds)
        );
      }

      if (connection.options.socketTimeout) {
        connectionUrl += ConnectionHelper.addOptionToUrl(
          connectionUrl,
          'socketTimeoutMS',
          getRoundedMilisecondsFromSeconds(connection.options.socketTimeout)
        );
      } else {
        connectionUrl += ConnectionHelper.addOptionToUrl(
          connectionUrl,
          'socketTimeoutMS',
          getRoundedMilisecondsFromSeconds(settings.socketTimeoutInSeconds)
        );
      }

      if (connection.options.replicaSetName) {
        connectionUrl += ConnectionHelper.addOptionToUrl(
          connectionUrl,
          'replicaSet',
          connection.options.replicaSetName
        );
      }
    }

    if (connection.ssl && connection.ssl.enabled) {
      connectionUrl += ConnectionHelper.addOptionToUrl(
        connectionUrl,
        'ssl',
        'true'
      );
    }
    if (connection.authenticationType) {
      connectionUrl += ConnectionHelper.addOptionToUrl(
        connectionUrl,
        'authMechanism',
        connection.authenticationType
          .toUpperCase()
          .replace(new RegExp('_', 'g'), '-')
      );
    }

    if (addAuthSource) {
      if (
        connection.authenticationType === 'mongodb_cr' ||
        connection.authenticationType === 'scram_sha_1' ||
        connection.authenticationType === 'scram_sha_256'
      ) {
        if (connection[connection.authenticationType].authSource) {
          connectionUrl += ConnectionHelper.addOptionToUrl(
            connectionUrl,
            'authSource',
            connection[connection.authenticationType].authSource
          );
        } else {
          connectionUrl += ConnectionHelper.addOptionToUrl(
            connectionUrl,
            'authSource',
            connection.databaseName
          );
        }
      } else if (
        connection.authenticationType === 'gssapi' ||
        connection.authenticationType === 'plain'
      ) {
        connectionUrl += ConnectionHelper.addOptionToUrl(
          connectionUrl,
          'authSource',
          '$external'
        );
      }
    }

    return connectionUrl;
  },

  getShellConnectionParams(connectionUrl) {
    Logger.debug({
      message: 'getShellConnectionParams',
      metadataToLog: {
        connectionUrl,
      },
    });
    let mongoShellParams = [connectionUrl];
    // TLS support
    if (connectionUrl.includes('tls=')) {
      mongoShellParams.push('--tls');
      if (connectionUrl.includes('tlsCAFile=')) {
        const rxTlsCAFile = /.*tlsCAFile=(.+\.pem).*/;
        const matchTlsCAFile = connectionUrl.match(rxTlsCAFile);
        mongoShellParams.push('--tlsCAFile');
        mongoShellParams.push(matchTlsCAFile[1]);
      }
      if (connectionUrl.includes('tlsCertificateKeyFile=')) {
        const rxTlsCertKeyFile = /.*tlsCertificateKeyFile=(.+\.pem).*/;
        const matchTlsCertKeyFile = connectionUrl.match(rxTlsCertKeyFile);
        mongoShellParams.push('--tlsCertificateKeyFile');
        mongoShellParams.push(matchTlsCertKeyFile[1]);
      }
      if (connectionUrl.includes('tlsCertificateKeyFilePassword=')) {
        const rxTlsCertKeyFilePass = /.*tlsCertificateKeyFilePassword=(.+)&.*/;
        const matchTlsCertKeyFilePass = connectionUrl.match(
          rxTlsCertKeyFilePass
        );
        mongoShellParams.push('--tlsCertificateKeyFilePassword');
        mongoShellParams.push(matchTlsCertKeyFilePass[1]);
      }
      if (connectionUrl.includes('tlsCertificateSelector=')) {
        const rxTlsCertificateSelector = /.*tlsCertificateSelector=(.+)&.*/;
        const matchTlsCertificateSelector = connectionUrl.match(
          rxTlsCertificateSelector
        );
        mongoShellParams.push('--tlsCertificateSelector');
        mongoShellParams.push(matchTlsCertificateSelector[1]);
      }
    } else if (connectionUrl.includes('ssl=')) {
      // SSL support
      mongoShellParams.push('--ssl');
      if (connectionUrl.includes('sslCAFile=')) {
        const rxSslCAFile = /.*sslCAFile=(.+\.pem).*/;
        const matchSslCAFile = connectionUrl.match(rxSslCAFile);
        mongoShellParams.push('--sslCAFile');
        mongoShellParams.push(matchSslCAFile[1]);
      }
      if (connectionUrl.includes('sslPEMKeyFile=')) {
        const rxSslPemKeyFile = /.*sslPEMKeyFile=(.+\.pem).*/;
        const matchSslPemKeyFile = connectionUrl.match(rxSslPemKeyFile);
        mongoShellParams.push('--sslPEMKeyFile');
        mongoShellParams.push(matchSslPemKeyFile[1]);
      }
      if (connectionUrl.includes('sslPEMKeyFilePassword=')) {
        const rxSslPemKeyFilePass = /.*sslPEMKeyFilePassword=(.+)&.*/;
        const matchSslPemKeyFilePass = connectionUrl.match(rxSslPemKeyFilePass);
        mongoShellParams.push('--sslCertificateKeyFilePassword');
        mongoShellParams.push(matchSslPemKeyFilePass[1]);
      }
      if (connectionUrl.includes('sslCertificateSelector=')) {
        const rxSslCertificateSelector = /.*sslCertificateSelector=(.+)&.*/;
        const matchSslCertificateSelector = connectionUrl.match(
          rxSslCertificateSelector
        );
        mongoShellParams.push('--sslCertificateSelector');
        mongoShellParams.push(matchSslCertificateSelector[1]);
      }
    }
    return mongoShellParams;
  },

  getConnectionOptions(connection) {
    const result = { useNewUrlParser: true, useUnifiedTopology: true };
    if (connection.authenticationType === 'mongodb_x509') {
      addSSLOptions(connection.mongodb_x509, result);
    }
    if (connection.ssl && connection.ssl.enabled) {
      addSSLOptions(connection.ssl, result);
    }
    if (connection.options && connection.options.connectWithNoPrimary) {
      result.connectWithNoPrimary = true;
    }

    // added authSource to here to provide same authSource as DB name if it's not provided when connection is being used by URL
    if (
      connection.authenticationType === 'mongodb_cr' ||
      connection.authenticationType === 'scram_sha_1' ||
      connection.authenticationType === 'scram_sha_256'
    ) {
      if (connection[connection.authenticationType].authSource) {
        result.authSource =
          connection[connection.authenticationType].authSource;
      } else result.authSource = connection.databaseName;
    } else if (
      connection.authenticationType === 'gssapi' ||
      connection.authenticationType === 'plain'
    ) {
      result.authSource = '$external';
    }
    return result;
  },
};

export default new Connection();
