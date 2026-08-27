// Backend order data storage for CAPI Purchase events
// Captures key form data at submission time for later confirmation

import { FULANI_API_URL, WEBHOOK_SECRET } from '@/config/api';

export interface StoredOrderData {
  orderId: string;
  timestamp: number;
  customerFullName: string;
  phoneNumber: string;
  email: string;
  packageName: string;
  packagePrice: number;
  deliveryFee: number;
  totalAmount: number;
  state: string;
  lga: string;
  address: string;
  paymentMethod: string;
  orderStatus: 'pending' | 'confirmed' | 'cancelled';
}

/**
 * Store order data securely at time of submission
 * This ensures we have complete data for CAPI Purchase event during confirmation
 */
export async function storeOrderData(orderData: Omit<StoredOrderData, 'timestamp' | 'orderStatus'>): Promise<boolean> {
  try {
    const storedData: StoredOrderData = {
      ...orderData,
      timestamp: Date.now(),
      orderStatus: 'pending'
    };

    // Store in multiple locations for redundancy
    const storagePromises = [
      // Session storage (immediate access)
      storeInSessionStorage(orderData.orderId, storedData),
      // Google Apps Script (persistent storage)
      storeInGoogleSheets(storedData),
      // Local storage (backup)
      storeInLocalStorage(orderData.orderId, storedData)
    ];

    const results = await Promise.allSettled(storagePromises);
    const successCount = results.filter(r => r.status === 'fulfilled').length;
    
    console.log(`[Order Storage] Stored order data: ${orderData.orderId} (${successCount}/3 locations)`);
    
    return successCount >= 2; // Success if stored in at least 2 locations
  } catch (error) {
    console.error('[Order Storage] Failed to store order data:', error);
    return false;
  }
}

/**
 * Retrieve stored order data for confirmation
 */
export async function retrieveOrderData(orderId: string): Promise<StoredOrderData | null> {
  try {
    // Try session storage first (fastest)
    let orderData = getFromSessionStorage(orderId);
    
    // Fallback to local storage
    if (!orderData) {
      orderData = getFromLocalStorage(orderId);
    }
    
    // Final fallback to Google Sheets (slower but reliable)
    if (!orderData) {
      orderData = await getFromGoogleSheets(orderId);
    }
    
    console.log(`[Order Storage] Retrieved order data: ${orderId} - ${orderData ? 'Found' : 'Not found'}`);
    return orderData;
  } catch (error) {
    console.error('[Order Storage] Failed to retrieve order data:', error);
    return null;
  }
}

/**
 * Update order status after confirmation
 */
export async function updateOrderStatus(orderId: string, status: StoredOrderData['orderStatus']): Promise<boolean> {
  try {
    const orderData = await retrieveOrderData(orderId);
    if (!orderData) {
      console.error('[Order Storage] Cannot update status - order not found:', orderId);
      return false;
    }

    const updatedData: StoredOrderData = {
      ...orderData,
      orderStatus: status,
      timestamp: Date.now() // Update timestamp
    };

    // Update in all storage locations
    await Promise.allSettled([
      updateInSessionStorage(orderId, updatedData),
      updateInLocalStorage(orderId, updatedData),
      updateInGoogleSheets(updatedData)
    ]);

    console.log(`[Order Storage] Updated order status: ${orderId} -> ${status}`);
    return true;
  } catch (error) {
    console.error('[Order Storage] Failed to update order status:', error);
    return false;
  }
}

// Session Storage Functions
function storeInSessionStorage(orderId: string, data: StoredOrderData): Promise<void> {
  return new Promise((resolve) => {
    try {
      const key = `fhg_order_${orderId}`;
      sessionStorage.setItem(key, JSON.stringify(data));
      resolve();
    } catch (error) {
      console.warn('[Session Storage] Store failed:', error);
      resolve(); // Don't reject, continue with other storage methods
    }
  });
}

function getFromSessionStorage(orderId: string): StoredOrderData | null {
  try {
    const key = `fhg_order_${orderId}`;
    const data = sessionStorage.getItem(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.warn('[Session Storage] Retrieve failed:', error);
    return null;
  }
}

function updateInSessionStorage(orderId: string, data: StoredOrderData): Promise<void> {
  return storeInSessionStorage(orderId, data);
}

// Local Storage Functions
function storeInLocalStorage(orderId: string, data: StoredOrderData): Promise<void> {
  return new Promise((resolve) => {
    try {
      const key = `fhg_order_${orderId}`;
      localStorage.setItem(key, JSON.stringify(data));
      resolve();
    } catch (error) {
      console.warn('[Local Storage] Store failed:', error);
      resolve();
    }
  });
}

function getFromLocalStorage(orderId: string): StoredOrderData | null {
  try {
    const key = `fhg_order_${orderId}`;
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.warn('[Local Storage] Retrieve failed:', error);
    return null;
  }
}

function updateInLocalStorage(orderId: string, data: StoredOrderData): Promise<void> {
  return storeInLocalStorage(orderId, data);
}

// Google Sheets Storage Functions
async function storeInGoogleSheets(data: StoredOrderData): Promise<void> {
  try {
    const payload = {
      secret: WEBHOOK_SECRET,
      type: 'store_order_data',
      ...data
    };

    const body = new URLSearchParams(
      Object.entries(payload).map(([k, v]) => [k, v == null ? '' : String(v)])
    );

    const response = await fetch(FULANI_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body
    });
    if (!response.ok) {
      throw new Error(`Store failed: HTTP ${response.status}`);
    }
  } catch (error) {
    console.error('[Google Sheets Storage] Store failed:', error);
    throw error;
  }
}

async function getFromGoogleSheets(orderId: string): Promise<StoredOrderData | null> {
  try {
    const payload = {
      secret: WEBHOOK_SECRET,
      type: 'retrieve_order_data',
      orderId
    };

    const body = new URLSearchParams(
      Object.entries(payload).map(([k, v]) => [k, v == null ? '' : String(v)])
    );

    const response = await fetch(FULANI_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const result = await response.json();
    return result.data || null;
  } catch (error) {
    console.error('[Google Sheets Storage] Retrieve failed:', error);
    return null;
  }
}

async function updateInGoogleSheets(data: StoredOrderData): Promise<void> {
  try {
    const payload = {
      secret: WEBHOOK_SECRET,
      type: 'update_order_status',
      ...data
    };

    const body = new URLSearchParams(
      Object.entries(payload).map(([k, v]) => [k, v == null ? '' : String(v)])
    );

    const response = await fetch(FULANI_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body
    });
    if (!response.ok) {
      throw new Error(`Update failed: HTTP ${response.status}`);
    }
  } catch (error) {
    console.error('[Google Sheets Storage] Update failed:', error);
    throw error;
  }
}

export default {
  storeOrderData,
  retrieveOrderData,
  updateOrderStatus
};
