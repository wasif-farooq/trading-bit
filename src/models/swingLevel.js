class SwingLevel {
	constructor({
		type,
		price,
		timestamp,
		timeframes = [],
		confirmationCount = 1,
		qualityScore = 0,
		originalTimestamp
	}) {
		this.type = type;
		this.price = price;
		this.timestamp = timestamp;
		this.timeframes = timeframes;
		this.confirmationCount = confirmationCount;
		this.qualityScore = qualityScore;
		this.originalTimestamp = originalTimestamp || timestamp;
	}

	toJSON() {
		return {
			type: this.type,
			price: this.price,
			timestamp: this.timestamp,
			timeframes: this.timeframes,
			confirmationCount: this.confirmationCount,
			qualityScore: this.qualityScore,
			originalTimestamp: this.originalTimestamp
		};
	}
}

module.exports = { SwingLevel };

