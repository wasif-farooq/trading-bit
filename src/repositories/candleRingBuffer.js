class CandleRingBuffer {
	constructor(capacity = 10000) {
		this.capacity = capacity;
		this.buffer = new Array(capacity);
		this.size = 0;
		this.head = 0;
		this.tail = 0;
	}

	push(candle) {
		this.buffer[this.tail] = candle;
		this.tail = (this.tail + 1) % this.capacity;

		if (this.size < this.capacity) {
			this.size++;
		} else {
			this.head = (this.head + 1) % this.capacity;
		}
	}

	getAll() {
		if (this.size === 0) return [];

		const result = [];
		for (let i = 0; i < this.size; i++) {
			const index = (this.head + i) % this.capacity;
			result.push(this.buffer[index]);
		}
		return result;
	}

	getRecent(count) {
		const all = this.getAll();
		return all.slice(-count);
	}

	getSize() {
		return this.size;
	}

	clear() {
		this.buffer = new Array(this.capacity);
		this.size = 0;
		this.head = 0;
		this.tail = 0;
	}
}

module.exports = { CandleRingBuffer };

