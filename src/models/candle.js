class Candle {
	constructor({
		timestamp,
		open,
		high,
		low,
		close,
		volume = 0,
		originalTimestamp
	}) {
		this.timestamp = timestamp;
		this.open = open;
		this.high = high;
		this.low = low;
		this.close = close;
		this.volume = volume;
		this.originalTimestamp = originalTimestamp || timestamp;
	}

	toJSON() {
		return {
			timestamp: this.timestamp,
			open: this.open,
			high: this.high,
			low: this.low,
			close: this.close,
			volume: this.volume,
			originalTimestamp: this.originalTimestamp
		};
	}
}

module.exports = { Candle };

