const ConnectionHelper = function () {};

ConnectionHelper.prototype = {
  changeUsernameAndPasswordFromConnectionUrl(connection, username, password) {
    const splitedForDash = connection.url.split('//');

    if (connection.url.indexOf('@') !== -1) {
      const splitedForAt = splitedForDash[1].split('@');
      const usernameAndPassword = splitedForAt[0].split(':');
      if (!username) [username] = usernameAndPassword;
      if (!password) [, password] = usernameAndPassword;

      connection.url = `${splitedForDash[0]}//${username}:${password}@${splitedForAt[1]}`;
    } else {
      connection.url = `${splitedForDash[0]}//${username}:${password}@${splitedForDash[1]}`;
    }
  },

  extractDBFromConnectionUrl(connection) {
    let options = '';
    if (connection.url.indexOf('?') !== -1) {
      options = `?${connection.url.split('?')[1]}`;
    }

    const splited = connection.url.split('/');
    if (splited.length <= 3) connection.url += `/${options}`;
    else {
      splited[3] = '';
      connection.url = splited.join('/') + options;
    }
  },

  putCorrectDBToConnectionUrl(connection) {
    let options = '';
    if (connection.url.indexOf('?') !== -1) {
      options = `?${connection.url.split('?')[1]}`;
    }

    const splited = connection.url.split('/');
    if (splited.length <= 3) {
      connection.url += `/${connection.databaseName}${options}`;
    } else {
      splited[3] = '';
      connection.url =
        splited.slice(0, 3).join('/') + `/${connection.databaseName}${options}`;
    }
  },

  addAuthSourceToConnectionUrl(connection) {
    if (connection.url.indexOf('authSource') !== -1) return;
    connection.url += this.addOptionToUrl(
      connection.url,
      'authSource',
      connection.databaseName
    );
  },

  addOptionToUrl(url, option, value) {
    if (!value) return '';
    if (url.substring(url.lastIndexOf('/')).indexOf('?') === -1) {
      return `?${option}=${value}`;
    }
    return `&${option}=${value}`;
  },
};

export default new ConnectionHelper();
