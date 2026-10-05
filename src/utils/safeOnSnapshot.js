// onSnapshot, for every listener in the app: same arguments, same
// unsubscribe, but a crashed Firestore client can't throw out of either end
// into React. See guardListener in firestoreClientHealth for why.
import { onSnapshot as sdkOnSnapshot } from 'firebase/firestore';
import { guardListener } from './firestoreClientHealth';

export function onSnapshot(...args) {
  return guardListener(() => sdkOnSnapshot(...args));
}
