const WebSocket = require('ws');
const http = require('http');
const { TickStreamer } = require('./tickStreamer');
const path = require('path');

class SimulationServer {
	constructor(options = {}) {
		this.port = options.port || 8081;
		this.csvFilePath = options.csvFilePath || path.join(__dirname, 'data', 'ticks.csv');
		this.playbackSpeed = options.playbackSpeed || 1.0;
		this.fixedInterval = options.fixedInterval || null;

		this.server = null;
		this.wss = null;
		this.tickStreamer = null;
		this.clients = new Set();
		this.isRunning = false;
	}

	async start() {
		// Create HTTP server
		this.server = http.createServer((req, res) => {
			if (req.url === '/health') {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({
					status: 'ok',
					clients: this.clients.size,
					streaming: this.tickStreamer ? this.tickStreamer.isStreaming : false,
					progress: this.tickStreamer ? this.tickStreamer.getProgress() : null
				}));
			} else if (req.url === '/status') {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({
					port: this.port,
					csvFile: this.csvFilePath,
					playbackSpeed: this.playbackSpeed,
					fixedInterval: this.fixedInterval,
					clients: this.clients.size,
					streaming: this.tickStreamer ? this.tickStreamer.isStreaming : false,
					progress: this.tickStreamer ? this.tickStreamer.getProgress() : null
				}));
			} else {
				res.writeHead(404, { 'Content-Type': 'text/plain' });
				res.end('Not Found');
			}
		});

		// Create WebSocket server
		this.wss = new WebSocket.Server({ server: this.server });

		this.wss.on('connection', (ws) => {
			this.clients.add(ws);
			console.log(`Client connected. Total clients: ${this.clients.size}`);

			ws.on('message', (message) => {
				try {
					const data = JSON.parse(message.toString());
					this.handleMessage(ws, data);
				} catch (error) {
					console.error('Error parsing message:', error);
				}
			});

			ws.on('close', () => {
				this.clients.delete(ws);
				console.log(`Client disconnected. Total clients: ${this.clients.size}`);
			});

			ws.on('error', (error) => {
				console.error('WebSocket error:', error);
				this.clients.delete(ws);
			});

			// Send welcome message
			ws.send(JSON.stringify({
				type: 'connected',
				message: 'Connected to simulation server'
			}));
		});

		// Initialize tick streamer
		this.tickStreamer = new TickStreamer(this.csvFilePath, {
			playbackSpeed: this.playbackSpeed,
			fixedInterval: this.fixedInterval
		});

		this.tickStreamer.on('tick', (tick) => {
			// Broadcast tick to all connected clients
			const message = JSON.stringify({
				type: 'tick',
				data: tick
			});

			this.clients.forEach((client) => {
				if (client.readyState === WebSocket.OPEN) {
					client.send(message);
				}
			});
		});

		this.tickStreamer.on('complete', () => {
			console.log('Tick streaming completed');
			this.broadcast({
				type: 'complete',
				message: 'Tick streaming completed'
			});
		});

		this.tickStreamer.on('error', (error) => {
			console.error('Tick streamer error:', error);
			this.broadcast({
				type: 'error',
				message: error.message
			});
		});

		// Load ticks
		try {
			await this.tickStreamer.loadTicks();
			console.log(`Loaded ${this.tickStreamer.ticks.length} ticks from ${this.csvFilePath}`);
		} catch (error) {
			console.error('Error loading ticks:', error);
			throw error;
		}

		// Start HTTP server
		return new Promise((resolve, reject) => {
			this.server.listen(this.port, () => {
				this.isRunning = true;
				console.log(`Simulation server listening on port ${this.port}`);
				console.log(`WebSocket endpoint: ws://localhost:${this.port}`);
				resolve();
			});

			this.server.on('error', (error) => {
				reject(error);
			});
		});
	}

	handleMessage(ws, data) {
		switch (data.type) {
			case 'start':
				if (this.tickStreamer && !this.tickStreamer.isStreaming) {
					this.tickStreamer.start();
					ws.send(JSON.stringify({
						type: 'started',
						message: 'Tick streaming started'
					}));
				}
				break;

			case 'stop':
				if (this.tickStreamer) {
					this.tickStreamer.stop();
					ws.send(JSON.stringify({
						type: 'stopped',
						message: 'Tick streaming stopped'
					}));
				}
				break;

			case 'reset':
				if (this.tickStreamer) {
					this.tickStreamer.reset();
					ws.send(JSON.stringify({
						type: 'reset',
						message: 'Tick streamer reset'
					}));
				}
				break;

			case 'get_status':
				ws.send(JSON.stringify({
					type: 'status',
					data: {
						streaming: this.tickStreamer ? this.tickStreamer.isStreaming : false,
						progress: this.tickStreamer ? this.tickStreamer.getProgress() : null
					}
				}));
				break;

			default:
				ws.send(JSON.stringify({
					type: 'error',
					message: `Unknown message type: ${data.type}`
				}));
		}
	}

	broadcast(message) {
		const data = JSON.stringify(message);
		this.clients.forEach((client) => {
			if (client.readyState === WebSocket.OPEN) {
				client.send(data);
			}
		});
	}

	async stop() {
		this.isRunning = false;

		if (this.tickStreamer) {
			this.tickStreamer.stop();
		}

		// Close all client connections
		this.clients.forEach((client) => {
			client.close();
		});
		this.clients.clear();

		// Close WebSocket server
		if (this.wss) {
			return new Promise((resolve) => {
				this.wss.close(() => {
					resolve();
				});
			});
		}

		// Close HTTP server
		if (this.server) {
			return new Promise((resolve) => {
				this.server.close(() => {
					resolve();
				});
			});
		}
	}
}

// Start server if run directly
if (require.main === module) {
	const port = parseInt(process.env.SIMULATION_PORT || '8081', 10);
	const csvFilePath = process.env.CSV_FILE_PATH || path.join(__dirname, 'data', 'ticks.csv');
	const playbackSpeed = parseFloat(process.env.PLAYBACK_SPEED || '1.0');
	const fixedInterval = process.env.FIXED_INTERVAL ? parseInt(process.env.FIXED_INTERVAL, 10) : null;

	const server = new SimulationServer({
		port,
		csvFilePath,
		playbackSpeed,
		fixedInterval
	});

	server.start().catch((error) => {
		console.error('Failed to start simulation server:', error);
		process.exit(1);
	});

	process.on('SIGINT', async () => {
		console.log('\nShutting down simulation server...');
		await server.stop();
		process.exit(0);
	});
}

module.exports = { SimulationServer };

