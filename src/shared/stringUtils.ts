/**
 * Shared String Utilities
 */

/**
 * Strips "thought" tags and their content from a string.
 * Used to hide internal reasoning chains from the user in production.
 * 
 * Handles:
 * - [[THOUGHT]]...[[/THOUGHT]] blocks (removed entirely)
 * - Standalone [[THOUGHT]] or [[/THOUGHT]] tags (removed)
 * 
 * @param text - The input text containing potential thought tags
 * @returns The cleaned text
 */
export function stripThoughtTags(text: string): string {
    let clean = text.replace(/\[\[THOUGHT\]\][\s\S]*?\[\[\/THOUGHT\]\]/g, '');
    clean = clean.replace(/\[\[THOUGHT\]\]/g, '').replace(/\[\[\/THOUGHT\]\]/g, '');
    return clean;
}

/**
 * Calculates the new text added to a stream (delta) given the full text 
 * and the previously processed text.
 * 
 * @param fullText - The current full text from the stream
 * @param previousText - The text that was already processed
 * @returns The new text chunk (delta)
 */
export function getOutputTranscriptionDelta(fullText: string, previousText: string): string {
    return fullText.startsWith(previousText)
        ? fullText.slice(previousText.length)
        : fullText;
}

/**
 * Helper to build system instructions with context.
 * 
 * @param baseInstruction - The core system prompt
 * @param sessionSummaries - Optional array of summaries from previous sessions
 * @param knowledgeContext - Optional knowledge context string
 * @returns The full system instruction with context appended
 */
export function appendSessionContext(
    baseInstruction: string, 
    sessionSummaries: string[] = [], 
    knowledgeContext: string = ''
): string {
    let instruction = baseInstruction;
    
    // Append Time
    const currentTime = new Date().toLocaleString('en-US', {
        dateStyle: 'full', 
        timeStyle: 'long'
    });
    instruction += `\n\nCurrent System Time: ${currentTime}\n`;

    // Append Session Summaries
    if (sessionSummaries.length > 0) {
        instruction += '\nPrevious Session Context:\n';
        sessionSummaries.forEach((s, i) => {
            instruction += `Session ${i + 1}: ${s}\n`;
        });
    }

    // Append Knowledge Context
    if (knowledgeContext) {
        instruction += '\nAdditional Context:\n' + knowledgeContext;
    }

    return instruction;
}
