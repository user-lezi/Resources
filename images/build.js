const { join } = require('path');
const { writeFileSync, existsSync, statSync } = require('fs');
const { loadImage, createCanvas } = require('@napi-rs/canvas');
const cliProgress = require('cli-progress');

async function build() {

    // -----------------------------
    // Extract dominant colors
    // -----------------------------
    function extractDominantColors(imageData) {
        const data = imageData.data;
        const colorMap = {};

        const step = 10 * 4; // every 10th pixel (RGBA)

        for (let i = 0; i < data.length; i += step) {
            const r = Math.floor(data[i] / 32) * 32;
            const g = Math.floor(data[i + 1] / 32) * 32;
            const b = Math.floor(data[i + 2] / 32) * 32;

            const key = `${r},${g},${b}`;
            colorMap[key] = (colorMap[key] || 0) + 1;
        }

        const sortedColors = Object.entries(colorMap)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 3)
            .map(([color]) => {
                const [r, g, b] = color.split(',').map(Number);
                return (r << 16) | (g << 8) | b;
            });

        while (sortedColors.length < 3) {
            sortedColors.push(0);
        }

        return sortedColors;
    }

    // -----------------------------
    // Extract image info
    // -----------------------------
    async function extractImageInfo(filePath) {
        const result = {
            dominantcolor: [],
            size: { bytes: 0, width: 0, height: 0 }
        };

        try {
            const fullPath = join(__dirname, filePath);

            if (existsSync(fullPath)) {
                const stats = statSync(fullPath);
                result.size.bytes = stats.size;

                const image = await loadImage(fullPath);
                result.size.width = image.width;
                result.size.height = image.height;

                const canvas = createCanvas(image.width, image.height);
                const ctx = canvas.getContext('2d');

                ctx.drawImage(image, 0, 0);

                const imageData = ctx.getImageData(
                    0,
                    0,
                    image.width,
                    image.height
                );

                result.dominantcolor = extractDominantColors(imageData);
            }
        } catch (err) {
            console.error(`Error processing ${filePath}:`, err.message);
        }

        return result;
    }

    // -----------------------------
    // Concurrency worker pool
    // -----------------------------
    async function processWithConcurrency(items, limit = 4) {
        const results = [];
        let index = 0;

        const progressBar = new cliProgress.SingleBar({
            format: 'Processing Images |{bar}| {percentage}% || {value}/{total} Images',
            barCompleteChar: '█',
            barIncompleteChar: '░',
            hideCursor: true
        });

        progressBar.start(items.length, 0);


        function toPosixPath(path) {
            return path.replace(/\\/g, '/');
        }
        async function worker() {
            while (true) {
                const currentIndex = index++;
                if (currentIndex >= items.length) break;

                const item = items[currentIndex];
                results[currentIndex] = {
                    file: toPosixPath(join("images", item.file)),
                    title: item.title,
                    description: item.description,
                    ...await extractImageInfo(item.file)
                };

                progressBar.increment();
            }
        }

        const workers = Array.from({ length: limit }, () => worker());
        await Promise.all(workers);

        progressBar.stop();

        return results;
    }

    // -----------------------------
    // Main execution
    // -----------------------------
    const rawData = require('./images.raw.json');

    const processedData = await processWithConcurrency(rawData, 4);

    const outputData = {
        $schema: "https://raw.githubusercontent.com/user-lezi/Resources/refs/heads/main/images/$schema.json",
        data: processedData
    };

    writeFileSync(
        join(__dirname, 'images.json'),
        JSON.stringify(outputData, null, 2)
    );

    console.log("Done! images.json generated.");

};

module.exports = { build };
