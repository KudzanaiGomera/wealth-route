const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } = require('firebase/firestore');

async function main() {
  const projectId = 'demo-wealthroute';
  const testEnvironment = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });

  try {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const other = testEnvironment.authenticatedContext('other').firestore();
    const anonymous = testEnvironment.unauthenticatedContext().firestore();
    const ownerRecord = doc(owner, 'users/owner/budgetLines/monthly-rent');
    const ownerClaim = doc(owner, 'usernames/owner_name');

    await assertSucceeds(setDoc(ownerRecord, { id: 'monthly-rent', amount: 1200 }));
    await assertSucceeds(getDoc(ownerRecord));
    await assertFails(getDoc(doc(other, 'users/owner/budgetLines/monthly-rent')));
    await assertFails(setDoc(doc(other, 'users/owner/budgetLines/stolen'), { amount: 1 }));
    await assertSucceeds(setDoc(doc(other, 'users/other/budgetLines/own'), { amount: 2 }));
    await assertFails(getDoc(doc(anonymous, 'users/owner/budgetLines/monthly-rent')));

    await assertSucceeds(setDoc(ownerClaim, { uid: 'owner' }));
    await assertSucceeds(getDoc(doc(anonymous, 'usernames/owner_name')));
    await assertFails(getDocs(collection(anonymous, 'usernames')));
    await assertFails(setDoc(doc(other, 'usernames/owner_name'), { uid: 'other' }));
    await assertFails(updateDoc(doc(other, 'usernames/owner_name'), { uid: 'other' }));
    await assertFails(deleteDoc(doc(other, 'usernames/owner_name')));
    await assertFails(updateDoc(ownerClaim, { uid: 'other' }));
    await assertSucceeds(updateDoc(ownerClaim, { uid: 'owner' }));

    console.log('Firestore rules isolate user records and protect username claims.');
  } finally {
    await testEnvironment.cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
