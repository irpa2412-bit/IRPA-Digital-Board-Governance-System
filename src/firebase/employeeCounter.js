import { collection, doc, getDocs, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "./config";

export async function synchronizeEmployeeCounter() {
  const snap = await getDocs(collection(db, "employees"));
  let maxNumber = 0;

  snap.docs.forEach((item) => {
    const value = String(item.data()?.employeeNumber || "");
    const match = value.match(/IRPA-EMP-(\d+)/i);
    if (match) maxNumber = Math.max(maxNumber, Number(match[1]) || 0);
  });

  // Counter state is zero-based: with no employees, the counter is exactly 0
  // and the next generated employee number is IRPA-EMP-00001.
  const nextNumber = maxNumber + 1;
  await setDoc(
    doc(db, "employeeCounters", "employees"),
    {
      currentNumber: maxNumber,
      nextNumber,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  return nextNumber;
}

export async function resetEmployeeCounterToZero() {
  await setDoc(
    doc(db, "employeeCounters", "employees"),
    {
      currentNumber: 0,
      nextNumber: 1,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  return 0;
}
