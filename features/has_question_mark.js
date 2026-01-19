/**
 * Detect question marks within the text content under a root element.
 *
 * Returns:
 * {
 *   text_question_mark_count: number,
 *   has_question_marks: boolean
 * }
 */
function detectQuestionMarks(rootEl) {
    const result = {
        text_question_mark_count: 0,
        has_question_marks: false
    };

    if (!rootEl) return result;

    const walker = document.createTreeWalker(
        rootEl,
        NodeFilter.SHOW_TEXT,
        null,
        false
    );

    while (walker.nextNode()) {
        const textNode = walker.currentNode;
        const text = (textNode.nodeValue || "");

        if (!text) continue;

        const matches = text.match(/\?/g);
        if (matches && matches.length > 0) {
            result.text_question_mark_count += matches.length;
        }
    }

    result.has_question_marks = result.text_question_mark_count > 0;

    return result;
}
