class Signal {
	constructor({
		timestamp,
		candleTimestamp,
		signalType,
		commonPointType,
		commonPointPrice,
		currentPrice,
		strength,
		qualityScore,
		timeframes,
		volume,
		barRange,
		signalStrength,
		confidence,
		buySignal = false,
		sellSignal = false
	}) {
		this.timestamp = timestamp;
		this.candleTimestamp = candleTimestamp;
		this.signalType = signalType;
		this.commonPointType = commonPointType;
		this.commonPointPrice = commonPointPrice;
		this.currentPrice = currentPrice;
		this.strength = strength;
		this.qualityScore = qualityScore;
		this.timeframes = timeframes;
		this.volume = volume;
		this.barRange = barRange;
		this.signalStrength = signalStrength;
		this.confidence = confidence;
		this.buySignal = buySignal;
		this.sellSignal = sellSignal;
	}

	toJSON() {
		return {
			timestamp: this.timestamp,
			candleTimestamp: this.candleTimestamp,
			signalType: this.signalType,
			commonPointType: this.commonPointType,
			commonPointPrice: this.commonPointPrice,
			currentPrice: this.currentPrice,
			strength: this.strength,
			qualityScore: this.qualityScore,
			timeframes: this.timeframes,
			volume: this.volume,
			barRange: this.barRange,
			signalStrength: this.signalStrength,
			confidence: this.confidence,
			buySignal: this.buySignal,
			sellSignal: this.sellSignal
		};
	}
}

module.exports = { Signal };

