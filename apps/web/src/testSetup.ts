import '@testing-library/jest-dom/vitest';
import { indexedDB } from 'fake-indexeddb';
(globalThis as { indexedDB: unknown }).indexedDB = indexedDB;
