// Persistence and Duplicate Prevention Store for Adda247 Form Practice Hub
// Models DynamoDB Single-Table Design: PK: STUDENT#<identifier>, SK: EXAM#<examId>

const STORAGE_KEY = "adda247_practice_entries_v1";

function getStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveStore(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error("Failed to save practice store:", e);
  }
}

export const practiceStore = {
  // Check if candidate with given mobile or email has already completed submission for examId
  isDuplicate(examId, identifier) {
    if (!identifier) return false;
    const cleanId = identifier.trim().toLowerCase();
    const store = getStore();
    const key = `STUDENT#${cleanId}_EXAM#${examId}`;
    return Boolean(store[key] && store[key].isSubmitted);
  },

  // Get candidate submission/draft by examId and identifier
  getEntry(examId, identifier) {
    if (!identifier) return null;
    const cleanId = identifier.trim().toLowerCase();
    const store = getStore();
    const key = `STUDENT#${cleanId}_EXAM#${examId}`;
    return store[key] || null;
  },

  // Save step-by-step progress
  saveProgress(examId, identifier, stepData, currentStep, isSubmitted = false) {
    if (!identifier) return null;
    const cleanId = identifier.trim().toLowerCase();
    const store = getStore();
    const key = `STUDENT#${cleanId}_EXAM#${examId}`;

    const existing = store[key] || {
      PK: `STUDENT#${cleanId}`,
      SK: `EXAM#${examId}`,
      createdAt: new Date().toISOString(),
      stepData: {},
    };

    const updatedEntry = {
      ...existing,
      updatedAt: new Date().toISOString(),
      currentStep: currentStep || existing.currentStep || 1,
      isSubmitted: isSubmitted || existing.isSubmitted || false,
      stepData: {
        ...existing.stepData,
        ...stepData,
      },
    };

    store[key] = updatedEntry;
    saveStore(store);
    return updatedEntry;
  },

  // Fetch all practice entries for the current browser/session
  getAllEntries() {
    const store = getStore();
    return Object.values(store);
  },

  // Clear entry (for testing/reset)
  clearEntry(examId, identifier) {
    if (!identifier) return;
    const cleanId = identifier.trim().toLowerCase();
    const store = getStore();
    const key = `STUDENT#${cleanId}_EXAM#${examId}`;
    delete store[key];
    saveStore(store);
  },
};
