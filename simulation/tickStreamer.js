const fs = require('fs');
const csv = require('csv-parser');
const EventEmitter = require('events');

class TickStreamer extends EventEmitter {
	constructor(csvFilePath, options = {}) {
		super();
		this.csvFilePath = csvFilePath;
		this.playbackSpeed = options.playbackSpeed || 1.0; // 1.0 = real-time, 2.0 = 2x speed
		this.fixedInterval = options.fixedInterval || null; // If set, ignore timestamps and use fixed interval
		this.isStreaming = false;
		this.ticks = [];
		this.currentIndex = 0;
		this.streamTimer = null;
	}

	async loadTicks() {
		return new Promise((resolve, reject) => {
			const ticks = [];

			if (!fs.existsSync(this.csvFilePath)) {
				reject(new Error(`CSV file not found: ${this.csvFilePath}`));
				return;
			}

			fs.createReadStream(this.csvFilePath)
				.pipe(csv({
					mapHeaders: ({ header, index }) => header.trim().replace(/^"(.*)"$/, '$1'),
					mapValues: ({ value, header }) => value.trim().replace(/^"(.*)"$/, '$1')
				}))
				.on('data', (row) => {
					try {
						const tick = this.parseRow(row);
						if (tick) {
							ticks.push(tick);
						}
					} catch (error) {
						this.emit('error', new Error(`Error parsing row: ${error.message}`));
					}
				})
				.on('end', () => {
					this.ticks = ticks;
					this.emit('loaded', ticks.length);
					resolve(ticks);
				})
				.on('error', (error) => {
					reject(error);
				});
		});
	}

	parseRow(row) {
		// Support multiple CSV formats
		// Format 1: Timestamp, Bid, Ask, Volume, Symbol
		// Format 2: timestamp, bid, ask, volume, symbol (lowercase)
		// Format 3: Timestamp, Price (use as both bid and ask), Volume, Symbol

		const timestampStr = row.Timestamp || row.timestamp || row.time || row.Time;
		if (!timestampStr) {
			return null;
		}

		let timestamp;
		try {
			// Try parsing as ISO string first
			if (timestampStr.includes('T') || timestampStr.includes('Z')) {
				timestamp = new Date(timestampStr);
			} else {
				// Try parsing as common formats
				timestamp = new Date(timestampStr.replace(' ', 'T') + 'Z');
			}
			if (isNaN(timestamp.getTime())) {
				return null;
			}
		} catch (error) {
			return null;
		}

		const bid = parseFloat(row.Bid || row.bid || row.price || row.Price);
		const ask = parseFloat(row.Ask || row.ask || row.price || row.Price);
		const volume = parseFloat(row.Volume || row.volume || row.vol || 0);
		const symbol = row.Symbol || row.symbol || row.instrument || '';

		if (isNaN(bid) || isNaN(ask)) {
			return null;
		}

		return {
			timestamp: timestamp.toISOString(),
			bid,
			ask: ask || bid, // If ask is not provided, use bid
			volume: isNaN(volume) ? 0 : volume,
			symbol: symbol || ''
		};
	}

	start() {
		if (this.isStreaming) {
			return;
		}

		if (this.ticks.length === 0) {
			this.emit('error', new Error('No ticks loaded. Call loadTicks() first.'));
			return;
		}

		this.isStreaming = true;
		this.currentIndex = 0;
		this.streamNextTick();
	}

	stop() {
		this.isStreaming = false;
		if (this.streamTimer) {
			clearTimeout(this.streamTimer);
			this.streamTimer = null;
		}
	}

	reset() {
		this.stop();
		this.currentIndex = 0;
	}

	streamNextTick() {
		if (!this.isStreaming || this.currentIndex >= this.ticks.length) {
			this.isStreaming = false;
			this.emit('complete');
			return;
		}

		const tick = this.ticks[this.currentIndex];
		this.emit('tick', tick);
		this.currentIndex++;

		if (this.fixedInterval) {
			// Use fixed interval
			this.streamTimer = setTimeout(() => {
				this.streamNextTick();
			}, this.fixedInterval / this.playbackSpeed);
		} else {
			// Use timestamps from CSV
			if (this.currentIndex < this.ticks.length) {
				const nextTick = this.ticks[this.currentIndex];
				const currentTime = new Date(tick.timestamp).getTime();
				const nextTime = new Date(nextTick.timestamp).getTime();
				const delay = Math.max(0, (nextTime - currentTime) / this.playbackSpeed);

				this.streamTimer = setTimeout(() => {
					this.streamNextTick();
				}, delay);
			} else {
				this.isStreaming = false;
				this.emit('complete');
			}
		}
	}

	getProgress() {
		if (this.ticks.length === 0) {
			return { current: 0, total: 0, percentage: 0 };
		}
		return {
			current: this.currentIndex,
			total: this.ticks.length,
			percentage: (this.currentIndex / this.ticks.length) * 100
		};
	}
}

module.exports = { TickStreamer };

