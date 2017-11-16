const Client = require('influx-client');
const QS = require('querystring');

class Client {
  constructor(options = {}) {
    const {client} = options;

    this.writer = new Client(options);
  }

  read() {}

  write(data, callback) {
    const url = this.getUrl();

    this.writer.write(data, callback);
  }
}

module.exports = Client;
