import {readFileSync} from 'node:fs';
import {normalizeDeliveryProfile} from '../../platform-protocol/src/delivery-package.js';
const presets = JSON.parse(readFileSync(new URL('../../../config/delivery-profiles.json', import.meta.url), 'utf8'));
export function channelDeliveryProfile(channel, configured) {
  const input = configured ? (typeof configured === 'string' ? JSON.parse(configured) : configured) :
    presets[`${channel.protocol_version}:${channel.distributor_code}:${channel.ta_code}`] ?? {};
  return normalizeDeliveryProfile(input, channel.protocol_version);
}
