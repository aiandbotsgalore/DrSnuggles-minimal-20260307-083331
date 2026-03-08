/**
 * Renderer Download Utilities
 */

/**
 * Triggers a browser download for a JSON object.
 * Handles Blob creation and URL revocation to prevent memory leaks.
 * 
 * @param data - The data object to download
 * @param filenamePrefix - Prefix for the filename (timestamp will be appended)
 */
export function downloadAsJson(data: unknown, filenamePrefix: string): void {
    try {
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `${filenamePrefix}-${Date.now()}.json`;
        document.body.appendChild(a); // Append to ensure click works in all browsers
        a.click();
        document.body.removeChild(a);
        
        // Revoke the URL to free memory
        // Small timeout to ensure the download starts before revocation
        setTimeout(() => URL.revokeObjectURL(url), 100);
    } catch (error) {
        console.error('Failed to download JSON:', error);
    }
}
