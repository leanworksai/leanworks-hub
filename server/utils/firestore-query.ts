import { FirebaseFirestore } from 'firebase-admin';

/**
 * Execute a Firestore query with automatic fallback for index errors
 * If the query fails due to missing index, executes the fallback query instead
 * 
 * @param queryFn - Function that returns a Firestore query promise
 * @param fallbackFn - Function that returns a fallback query promise (typically fetches all and sorts in memory)
 * @returns Query result
 */
export async function queryWithIndexFallback<T>(
  queryFn: () => Promise<FirebaseFirestore.QuerySnapshot>,
  fallbackFn: () => Promise<FirebaseFirestore.QuerySnapshot>
): Promise<FirebaseFirestore.QuerySnapshot> {
  try {
    return await queryFn();
  } catch (error: any) {
    // Check if it's a Firestore index error (code 9)
    if (error.code === 9 || error.message?.includes('index')) {
      console.warn('⚠️ Firestore index error detected, using fallback query');
      return await fallbackFn();
    } else {
      // Re-throw if it's not an index error
      throw error;
    }
  }
}
