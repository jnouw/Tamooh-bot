// Study system configuration constants
// Discord IDs can be overridden via environment variables

export const STUDY_CHANNEL_ID = process.env.STUDY_CHANNEL_ID || "1443362550447341609";
export const STUDY_LOG_CHANNEL_ID = process.env.STUDY_LOG_CHANNEL_ID || "1443363449504530492";
export const VOICE_CATEGORY_ID = process.env.VOICE_CATEGORY_ID || "1366787196719468645";
export const STUDY_ROLE_ID = process.env.STUDY_ROLE_ID || "1443203557628186755";
export const TAMOOH_ROLE_ID = process.env.TAMOOH_ROLE_ID || "1367043626806542336";
export const OWNER_ID = process.env.OWNER_ID || "274462470674972682";

export const EMPTY_TIMEOUT_MS = 30 * 1000; // 30 seconds before deleting empty VC
export const DELETE_DELAY_MS = 20 * 1000; // 20 seconds after completion
export const GROUP_QUEUE_THRESHOLD = 3; // Number of users needed to start group session
export const QUEUE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes - auto-start queue if not full
