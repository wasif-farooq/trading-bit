const fs = require('fs');
const path = require('path');

class MultiTimeframeAnalyzer {
	constructor() {
		this.timeframes = new Map();
	}

	addTimeframe(name, analyzer) {
		this.timeframes.set(name, analyzer);
	}

	findCommonSwingPoints() {
		const combined = new Map();

		this.timeframes.forEach((analyzer, timeframe) => {
			if (typeof analyzer.getSwingPoints !== 'function') return;
			const points = analyzer.getSwingPoints() || [];
			points.forEach((point) => {
				const key = this.getPointKey(point);
				const existing = combined.get(key);
				const pointCount = point.confirmationCount || 1;
				const enhancedPoint = {
					...point,
					timeframes: Array.isArray(point.timeframes) ? Array.from(new Set(point.timeframes.concat(timeframe))) : [timeframe],
					confirmationCount: pointCount
				};

				if (!existing) {
					combined.set(key, enhancedPoint);
				} else {
					existing.timeframes = Array.from(new Set(existing.timeframes.concat(enhancedPoint.timeframes)));
					existing.confirmationCount += pointCount;
					const existingQuality = existing.qualityScore || 0;
					const pointQuality = enhancedPoint.qualityScore || 0;
					existing.qualityScore = Math.max(existingQuality, pointQuality);
					existing.originalTimestamp = existing.originalTimestamp || enhancedPoint.originalTimestamp;
					combined.set(key, existing);
				}
			});
		});

		return Array.from(combined.values());
	}

	getPointKey(point) {
		const type = point.type || point.commonPointType || 'UNKNOWN';
		const price = typeof point.price === 'number' ? point.price : point.commonPointPrice;
		const roundedPrice = Math.round((price || 0) * 100000);
		return `${type}_${roundedPrice}`;
	}

	async exportCommonPointsToCSV(outputFile) {
		const commonPoints = this.findCommonSwingPoints();
		const header = [
			'Timestamp',
			'Type',
			'Price',
			'ConfirmationCount',
			'QualityScore',
			'Timeframes'
		];

		const lines = [header.join(',')];
		commonPoints.forEach(point => {
			const line = [
				point.timestamp || '',
				point.type || '',
				typeof point.price === 'number' ? point.price.toFixed(6) : '',
				point.confirmationCount || 0,
				typeof point.qualityScore === 'number' ? point.qualityScore.toFixed(2) : '',
				Array.isArray(point.timeframes) ? point.timeframes.join('|') : ''
			];
			lines.push(line.join(','));
		});

		await fs.promises.mkdir(path.dirname(outputFile), { recursive: true });
		await fs.promises.writeFile(outputFile, lines.join('\n'), 'utf8');
	}
}

module.exports = { MultiTimeframeAnalyzer };

