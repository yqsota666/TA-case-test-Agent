import { FILE_DEFINITIONS } from './definitions.js';
import { V21_FILE_DEFINITIONS } from './v21-definitions.js';
import { V21_OUTBOUND_DEFINITIONS } from './v21-outbound-definitions.js';
import { V22_EXTRA_FILE_DEFINITIONS } from './v22-extra-definitions.js';

const V21_DEFINITIONS = { ...V21_FILE_DEFINITIONS, ...V21_OUTBOUND_DEFINITIONS };
const V22_DEFINITIONS = { ...V22_EXTRA_FILE_DEFINITIONS, ...FILE_DEFINITIONS };

export const PROTOCOL_PROFILES = {
  '21': {
    version: '21', fields: V21_DEFINITIONS,
    dataHeaderWidths: [8, 4, 9, 9, 8, 3, 2, 8, 8, 3],
    indexHeaderWidths: [8, 4, 9, 9, 8, 3],
    recordCountWidth: 8
  },
  '22': {
    version: '22', fields: V22_DEFINITIONS,
    dataHeaderWidths: [8, 8, 20, 20, 8, 8, 8, 8, 8, 8],
    indexHeaderWidths: [8, 8, 20, 20, 8, 8],
    recordCountWidth: 16
  }
};

export function canonicalProtocolVersion(value) {
  const version = String(value ?? '').trim();
  if (version === '21' || version === '00000021') return '21';
  if (version === '22' || version === '00000022') return '22';
  throw new Error(`Unsupported protocol version ${version}`);
}

export function profileForVersion(value) {
  return PROTOCOL_PROFILES[canonicalProtocolVersion(value)];
}

export function fieldsForFile(version, fileType) {
  const fields = profileForVersion(version).fields[fileType];
  if (!fields) throw new Error(`Unsupported file type ${fileType} for protocol ${canonicalProtocolVersion(version)}`);
  return fields;
}
