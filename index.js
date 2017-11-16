const Debug = require('debug')('docker-agent');
const Client = require('influx-client');
const Http = require('http');

const {EventEmitter} = require('events');
const {
  DOCKER_VERSION,
  LOCAL,
  DATA_STORE,
  REMOTE_URL
} = process.env;

class Agent extends EventEmitter {
  constructor(options = {}) {
    super();

    this.buffer = [];
    this.client = new Client(options);
    this.containers = {};
    this.history = [];
    this.interval = null;
    this.pid = process.pid;
    this.polling = false;
    this.socket = '/var/run/docker.sock';
    this.store = DATA_STORE || 'influx';
    this.version = /*DOCKER_VERSION ||*/ 'v1.32';

    this.on('connected', this._onConnected);
    this.on('running', this._poll);
    this.on('start', this._start);
    this.on('stop', this._stop);
  }

  start() {
    if (!this.running) {
      this.running = true;
      this.emit('start');
    }
  }

  stop() {
    this.running = false;
    this.emit('stop');
  }

  _addContainers(containers) {
    containers.forEach(container => {
      if (container && container.State === 'running') {
        Debug(`Adding container ${container.Id}`);
        this.containers[container.Id] = container;
        this._stats(container.Id);
      }
    });
  }

  _cStart(evt) {
    const {id, from, time} = evt;

    if (!this.containers[id]) {
      this.containers[id] = {from, time};
      this._stats(id);
    }

    Debug(`New container added: ${JSON.stringify(this.containers)}`);
    
    this.history.push({time, id});
  }

  _cStop(id) {
    if (this.containers[id]) {
      delete this.containers[id];
      Debug(`Container ${id} has been removed`);
    }
  }

  _connect(path) {
    const request = Http.request({
        socketPath: this.socket,
        method: 'GET',
        path
      },
      (res) => {
        const _onConnect = () => this.emit('connected');
        const _onSocket = (socket) => {
          Debug(`Socket ${socket}`);
        };
        const _onData = (data) => this._log(data);
        const _onError = (error) => Debug(`Error ${error}`);
        const _onEnd = () => {
          Debug('connection end');
          res.destroy();
        }

        res.on('connect', _onConnect);
        res.on('socket', _onSocket)
        res.on('data', _onData);
        res.on('error', _onError);
        res.on('end', _onEnd);
    });

    request.on('error', (error) => {
      Debug(`Request error ${error.toString()}`);
    });

    request.end();
  }

  _filter(evt) {
    if (Array.isArray(evt)) {
      this._addContainers(evt);
    }

    const cLength = Object.keys(this.containers).length;

    if (evt && evt.Type === 'container') {
      const {id, from, time} = evt;

      Debug(`Adding containers ${evt.Type}`);

      this.history[id] = {from, time};

      switch (evt.status) {
        case 'start':
          this._cStart({id, from, time});
          break;
        case 'stop':
          this._cStop(id);
          break;
        default:
          Debug(`Unhandled status: ${evt.status}`);
      }
    }

    if (evt && evt.read && cLength) {
      const {
        id,
        name,
        read,
        num_procs,
        cpu_stats: {online_cpus,total_usage},
        memory_stats: {limit, max_usage, usage}
      } = evt;

      this._forward({
        id,
        name: name.replace('/', ''),
        read,
        num_procs,
        limit,
        max_usage,
        usage,
        online_cpus,
        total_usage
      });
    }
  }

  _flush() {}

  _forward(data) {
    this.client.write(data, (err, response) => {
      if (err) {
        this.buffer.push(data);
        return;
      }

      if (this.buffer.length) {
        setTimeout(() => {
          this._forward(this.buffer.shift());
        }, 5000);
      }
    });
  }

  _getStore() {
    let store = null;

    switch (this.store) {
      case 'influx':
        store = new InfluxStore();
        break;
      case 'prometheus':
        store = new PrometheusStore();
        break;
      default:
        Debug('No default store selected');
    }

    return store;
  }

  _log(data) {
    const json = this._parse(data);

    this._filter(json);
  }

  _onConnected() {}

  _parse(data) {
    let json = null;

    try {
      json = JSON.parse(data);
    }
    catch (e) {
      Debug(`Error parsing data ${data}`);
      Debug(e);
      json = JSON.parse(data.toString());
      Debug(`Error parsing json ${json}`);
    }

    return json;
  }

  _poll() {
    Debug(`Containers list ${Object.keys(this.containers)}`);
    Object.keys(this.containers).forEach(container => {
      this._stats(container);
    });
  }

  _start() {
    // Get a list of current containers
    this._connect(`http://${this.dockerVersion}/containers/json`);

    // Open socket for incoming/outgoing events
    this._connect(`http://${this.dockerVersion}/events`);

    // Poll current containers and get stats
    this._poll();
  }

  _stats(container) {
    Debug(`Starting stat collection on ${container}`);
    this._connect(`http://${this.dockerVersion}/containers/${container}/stats`);
  }

  _stop() {
    this.running = false;

    process.exit(1);
  }

}

const agent = new Agent();
agent.start();

process.on('SIGINT', () => {
  process.exit(1);
});
