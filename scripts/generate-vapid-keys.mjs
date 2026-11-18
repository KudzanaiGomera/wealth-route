import { webcrypto } from 'node:crypto';
import { ApplicationServerKeys, setWebCrypto } from 'webpush-webcrypto';

async function main() {
  setWebCrypto(webcrypto);
  const keys = await ApplicationServerKeys.generate();
  const serialized = await keys.toJSON();
  if (process.argv.includes('--check')) {
    if (!serialized.publicKey || !serialized.privateKey) throw new Error('Generated VAPID keys are incomplete.');
    const restored = await ApplicationServerKeys.fromJSON(serialized);
    const restoredJson = await restored.toJSON();
    if (restoredJson.publicKey !== serialized.publicKey || restoredJson.privateKey !== serialized.privateKey) throw new Error('Generated VAPID keys could not be restored.');
    console.log('VAPID key generation check passed.');
    return;
  }
  process.stdout.write(`${JSON.stringify(serialized)}\n`);
}

main().catch((error) => {
  console.error('Could not generate VAPID keys:', error.message);
  process.exitCode = 1;
});
