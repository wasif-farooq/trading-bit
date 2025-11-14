const { CONFIG } = require('../../config/config');
const logger = require('../../utils/logger');

class SwingAnalyzer {
	constructor(timeframe) {
		this.timeframe = timeframe;
		this.priceData = [];
		this.swingPoints = [];
		this.swingLeftBars = CONFIG.swingLeftBars || 5;
		this.swingRightBars = CONFIG.swingRightBars || 5;
		this.minSwingStrength = CONFIG.minSwingStrength || 0.001;
	}

	addPriceData(timestamp, open, high, low, close, volume, originalTimestamp) {
		this.priceData.push({
			timestamp,
			open,
			high,
			low,
			close,
			volume,
			originalTimestamp
		});
	}

	detectSwingPoints() {
		this.swingPoints = [];
		
		if (this.priceData.length < this.swingLeftBars + this.swingRightBars + 1) {
			logger.info(`[${this.timeframe}] Not enough data for swing detection: ${this.priceData.length} bars (need ${this.swingLeftBars + this.swingRightBars + 1})`);
			return; // Not enough data
		}
		
		logger.info(`[${this.timeframe}] Detecting swing points from ${this.priceData.length} bars (left: ${this.swingLeftBars}, right: ${this.swingRightBars}, minStrength: ${this.minSwingStrength})`);

		// Detect swing highs and lows
		for (let i = this.swingLeftBars; i < this.priceData.length - this.swingRightBars; i++) {
			const currentBar = this.priceData[i];
			
			// Check for swing high
			let isSwingHigh = true;
			let maxHigh = currentBar.high;
			
			// Check left bars
			for (let j = i - this.swingLeftBars; j < i; j++) {
				if (this.priceData[j].high >= currentBar.high) {
					isSwingHigh = false;
					break;
				}
				maxHigh = Math.max(maxHigh, this.priceData[j].high);
			}
			
			// Check right bars
			if (isSwingHigh) {
				for (let j = i + 1; j <= i + this.swingRightBars; j++) {
					if (this.priceData[j].high >= currentBar.high) {
						isSwingHigh = false;
						break;
					}
					maxHigh = Math.max(maxHigh, this.priceData[j].high);
				}
			}
			
			// Calculate swing strength for high
			if (isSwingHigh) {
				// Calculate average of surrounding bars for strength comparison
				const surroundingBars = [
					...this.priceData.slice(i - this.swingLeftBars, i),
					...this.priceData.slice(i + 1, i + this.swingRightBars + 1)
				];
				const avgHigh = surroundingBars.reduce((sum, bar) => sum + bar.high, 0) / surroundingBars.length;
				const strength = (currentBar.high - avgHigh) / avgHigh;
				
				// Use absolute value for strength check (minSwingStrength is a percentage)
				if (Math.abs(strength) >= this.minSwingStrength) {
					const swingPoint = {
						type: 'SWING_HIGH',
						price: currentBar.high,
						timestamp: currentBar.timestamp,
						originalTimestamp: currentBar.originalTimestamp,
						timeframe: this.timeframe,
						strength: Math.abs(strength),
						qualityScore: Math.abs(strength) * 100,
						confirmationCount: 1
					};
					this.swingPoints.push(swingPoint);
					logger.info(`[${this.timeframe}] Found SWING_HIGH at ${currentBar.high.toFixed(2)} (strength: ${(Math.abs(strength) * 100).toFixed(3)}%)`);
				}
			}
			
			// Check for swing low
			let isSwingLow = true;
			let minLow = currentBar.low;
			
			// Check left bars
			for (let j = i - this.swingLeftBars; j < i; j++) {
				if (this.priceData[j].low <= currentBar.low) {
					isSwingLow = false;
					break;
				}
				minLow = Math.min(minLow, this.priceData[j].low);
			}
			
			// Check right bars
			if (isSwingLow) {
				for (let j = i + 1; j <= i + this.swingRightBars; j++) {
					if (this.priceData[j].low <= currentBar.low) {
						isSwingLow = false;
						break;
					}
					minLow = Math.min(minLow, this.priceData[j].low);
				}
			}
			
			// Calculate swing strength for low
			if (isSwingLow) {
				// Calculate average of surrounding bars for strength comparison
				const surroundingBars = [
					...this.priceData.slice(i - this.swingLeftBars, i),
					...this.priceData.slice(i + 1, i + this.swingRightBars + 1)
				];
				const avgLow = surroundingBars.reduce((sum, bar) => sum + bar.low, 0) / surroundingBars.length;
				const strength = (avgLow - currentBar.low) / avgLow;
				
				// Use absolute value for strength check (minSwingStrength is a percentage)
				if (Math.abs(strength) >= this.minSwingStrength) {
					const swingPoint = {
						type: 'SWING_LOW',
						price: currentBar.low,
						timestamp: currentBar.timestamp,
						originalTimestamp: currentBar.originalTimestamp,
						timeframe: this.timeframe,
						strength: Math.abs(strength),
						qualityScore: Math.abs(strength) * 100,
						confirmationCount: 1
					};
					this.swingPoints.push(swingPoint);
					logger.info(`[${this.timeframe}] Found SWING_LOW at ${currentBar.low.toFixed(2)} (strength: ${(Math.abs(strength) * 100).toFixed(3)}%)`);
				}
			}
		}
		
		logger.info(`[${this.timeframe}] Swing detection complete: found ${this.swingPoints.length} swing points`);
	}

	getSwingPoints() {
		return this.swingPoints;
	}
}

module.exports = { SwingAnalyzer };

