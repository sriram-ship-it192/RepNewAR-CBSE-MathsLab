/**
 * MarkerGenerator.js - Printable AprilTag Generator
 * 
 * Responsibility:
 * - Generates high-contrast, printable AprilTag images.
 * - Provides downloadable formats (PNG/PDF) with precise physical dimensions.
 */

export class MarkerGenerator {
    /**
     * Generates a marker image.
     * @param {number} tagId - The unique ID for the tag.
     * @param {string} family - The AprilTag family (e.g., 'tag36h11').
     * @param {number} sizeCm - The physical size of the printed marker in cm.
     * @returns {Promise<string>} A data URL for the generated image.
     */
    async generate(tagId, family, sizeCm) {
        console.log(`MarkerGenerator: Generating tag ${tagId} from family ${family}.`);
        // TODO: Generate the tag image using the official AprilTag library
        return '';
    }

    /**
     * Triggers a download of the generated marker.
     * @param {string} dataUrl - The data URL of the image.
     * @param {string} filename - The desired filename.
     */
    download(dataUrl, filename) {
        // TODO: Create a temporary <a> tag and trigger download
    }
}
