const RWebSocket = require("./reconnecting-websocket");

class WebSocketRpc {

	constructor(options, rcCallback = null, statusCallback = null) {
		this.rcCallback = rcCallback;
		this.statusCallback = statusCallback;

		if (typeof WebSocket !== "undefined") {
            options.WebSocket = WebSocket;
			options.idleTreshold = "idleTreshold" in options ? options.idleTreshold : 60000; // Only use idle threshold in browsers
        } else {
            options.WebSocket = require("ws");
			options.idleTreshold = 0; // Always reconnect in node.js
        }
		options.reconnectInterval = 1000;
		options.reconnectDecay = 1.2;

		this.ws = new RWebSocket(options);
        this.ws.timeoutInterval = 15000;

		let initialConnect = true;

		this.connectPromise = new Promise((resolve, reject) => {

			this.ws.onopen = () => {
				if (this.statusCallback) this.statusCallback("open");
				if (initialConnect) {
                    initialConnect = false;
                    resolve();
                } else {
                    if(this.rcCallback) this.rcCallback();
                }
			}

			this.ws.onerror = (err) => {
				if (this.statusCallback) this.statusCallback("error");
				reject(err);
			}

			this.ws.onmessage = (message) => {
				let data = {};
				try {
					data = JSON.parse(message.data);
				} catch(e) {
					console.log("Unable to parse API response:", e);
					data.error = "Unable to parse response " + JSON.stringify(message);
				}
				this.listener(data);
			}

			this.ws.onclose = () => {
                // web socket may re-connect
                this.cbs.forEach(value => {
					value.reject('connection closed');
				})

				this.methodCbs.forEach(value => {
					value.reject('connection closed');
				})

                this.cbs.clear();
				this.methodCbs.clear();
				this.cbId = 0;

                if (this.statusCallback) this.statusCallback("closed");
            };
		});

		this.cbId = 0;
		this.cbs = new Map();
		this.methodCbs = new Map();

		if (typeof window !== "undefined") {
            window.onbeforeunload = () => {
                this.close();
            };
        }
	}

	listener(message) {
		let callback = this.cbs.get(message.id);
		let methodCallback = this.methodCbs.get(message.id);

		if (methodCallback) {
			this.methodCbs.delete(message.id);
			if ("error" in message && "reject" in methodCallback) {
				methodCallback.reject(message.error);
			} else if ("resolve" in methodCallback) {
				methodCallback.resolve();
			}
		}

		if (callback) {
			this.cbs.delete(message.id);
			if ("error" in message) {
				callback.reject(message.error);
			} else {
				callback.resolve(message.result);
			}
		}
	}

	call(params) {

		let request = {
            method: "call",
            params: params,
            id: this.cbId++
        };

		return new Promise((resolve, reject) => {

            this.cbs.set(request.id, {
                time: new Date(),
                resolve: resolve,
                reject: reject
            });

			if (request.params[1] === "broadcast_transaction_with_callback" && request.params[2][0]) {
				this.methodCbs.set(request.id, request.params[2][0]);
				request.params[2][0] = request.params[2][0].resolve;
			}

            this.ws.onerror = (error) => {
                reject(error);
            };

            this.ws.send(JSON.stringify(request));
        });
	}

	getApiByName(api) {
		return this.call([1, "get_api_by_name", [api]]);
	}

    login(user, password) {
        return this.connectPromise.then(() => {
            return this.call([1, "login", [user, password]]);
        });
    }

    close() {
		if (this.ws) {
			this.ws.onclose();
	        this.ws.close();
			this.ws = null;
		}
    }
}

module.exports = WebSocketRpc;
