// Sets up IndexedDB mock before Dexie loads.
// Dexie reads globalThis.indexedDB at module load time, so this must be
// imported BEFORE any module that imports dexie.
import { indexedDB } from 'fake-indexeddb';
(globalThis as { indexedDB: unknown }).indexedDB = indexedDB;
