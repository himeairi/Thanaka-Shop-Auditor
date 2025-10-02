import { productCSVData, sampleOrders } from './data.js';

// ===================================
// == FIREBASE SDK IMPORTS
// ===================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, writeBatch, serverTimestamp, collectionGroup, query, where, getDocs } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-firestore.js";


// ===================================
// == FIREBASE CONFIG
// ===================================
const firebaseConfig = {
  apiKey: "AIzaSyDMIl0gCaWjpcDHHBrM6HhYENi9edDDWKI",
  authDomain: "tiktok-audit-thanaka.firebaseapp.com",
  projectId: "tiktok-audit-thanaka",
  storageBucket: "tiktok-audit-thanaka.appspot.com",
  messagingSenderId: "95403940160",
  appId: "1:95403940160:web:c6b9096c61503c881842a5",
  measurementId: "G-H03BKG603V"
};

// ===================================
// == DOM ELEMENTS
// ===================================
const processBtn = document.getElementById('process-btn');
const copyBtn = document.getElementById('copy-btn');
const orderTextArea = document.getElementById('order-text');
const resultsSection = document.getElementById('results-section');
const resultsTableBody = document.getElementById('results-table-body');
const dailyLoadingDiv = document.getElementById('daily-loading');
const dailyProgressBar = document.getElementById('daily-progress-bar');
const weeklyLoadingDiv = document.getElementById('weekly-loading');
const weeklyProgressBar = document.getElementById('weekly-progress-bar');
const totalRevenueEl = document.getElementById('total-revenue');
const totalCostEl = document.getElementById('total-cost');
const totalOrdersEl = document.getElementById('total-orders');
const editDataBtn = document.getElementById('edit-data-btn');
const saveDataBtn = document.getElementById('save-data-btn');
const cancelDataBtn = document.getElementById('cancel-data-btn');
const resetDataBtn = document.getElementById('reset-data-btn');
const productDataTableContainer = document.getElementById('product-data-table-container');
const notificationPopup = document.getElementById('notification-popup');
const dailyAuditTab = document.getElementById('daily-audit-tab');
const weeklyAuditTab = document.getElementById('weekly-audit-tab');
const productDataTab = document.getElementById('product-data-tab');
const dailyAuditPanel = document.getElementById('daily-audit-panel');
const weeklyAuditPanel = document.getElementById('weekly-audit-panel');
const productDataPanel = document.getElementById('product-data-panel');
const calculateProfitBtn = document.getElementById('calculate-profit-btn');
const weeklyReportFile = document.getElementById('weekly-report-file');
const weeklyResultsSection = document.getElementById('weekly-results-section');
const weeklyResultsTableBody = document.getElementById('weekly-results-table-body');
const totalWeeklyProfitEl = document.getElementById('total-weekly-profit');
const totalWeeklyCostEl = document.getElementById('total-weekly-cost');
const totalWeeklyOrdersEl = document.getElementById('total-weekly-orders');
const copyWeeklyBtn = document.getElementById('copy-weekly-btn');
const collapsedOrderModal = document.getElementById('collapsed-order-modal');
const collapsedOrderList = document.getElementById('collapsed-order-list');
const closeModalBtn = document.getElementById('close-modal-btn');


// ===================================
// == STATE
// ===================================
let processedOrdersData = [];
let weeklyResultsData = [];
let masterProductData = {};
let db;
let auth;

// ===================================
// == CORE LOGIC
// ===================================

/**
 * Main controller for the daily audit. It checks for collapsed orders,
 * processes the text, calculates costs, displays results, and saves to the cloud.
 */
async function handleProcessOrders() {
    processedOrdersData = [];
    uiStartLoading('daily');
    
    // Use a short timeout to allow the UI to update before heavy processing
    setTimeout(async () => {
        const orderText = orderTextArea.value;
        if (!orderText.trim()) {
            alert("Please paste your order text.");
            uiStopLoading('daily');
            return;
        }

        try {
            // 1. Check for collapsed orders first
            const orderBlocks = orderText.split(/รหัสคำสั่งซื้อ\s*[:：]?\s*/).slice(1);
            const collapsedOrderIds = [];
            const orderIdRegex = /^\s*(\d+)/;

            for (const block of orderBlocks) {
                if (block.includes('แสดงสินค้าเพิ่มเติม')) {
                    const orderIdMatch = block.match(orderIdRegex);
                    if (orderIdMatch) {
                        collapsedOrderIds.push(orderIdMatch[1].trim());
                    }
                }
            }

            if (collapsedOrderIds.length > 0) {
                displayCollapsedOrderWarning(collapsedOrderIds);
                uiStopLoading('daily'); // Stop loading but don't show results
                return; // Halt the entire process
            }

            // Ensure product data is available (fallback to local if cloud not loaded)
            if (!masterProductData || !Array.isArray(masterProductData.products) || masterProductData.products.length === 0) {
                try {
                    masterProductData = parseProductSheet(productCSVData);
                } catch (e) {
                    console.error('Failed to initialize product data from local CSV:', e);
                }
            }

            // 2. Parse the orders from the text
            const orders = parseOrders(orderText, masterProductData);
            if (orders.length === 0) {
                throw new Error("Could not parse any orders. Please check the text format.");
            }
            
            // 3. Calculate costs for each order
            for (const order of orders) {
                let currentOrderTotalCost = 0;
                for (const item of order.items) {
                    const productInfo = findProductCost(item.productName, masterProductData);
                    if (productInfo) {
                        currentOrderTotalCost += productInfo.cost * item.quantity;
                        item.matchedProduct = productInfo.matchedProduct;
                    } else {
                        item.matchedProduct = { Matching_Keywords: 'NOT FOUND', Product_Name: item.productName, Image_URL: '' };
                    }
                }
                order.cost = currentOrderTotalCost;
                processedOrdersData.push(order);
            }

            // 4. Display results on the screen
            displayResults(processedOrdersData);

            // 5. Automatically save results to the cloud
            if (auth.currentUser && processedOrdersData.length > 0) {
                const userId = auth.currentUser.uid;
                const batch = writeBatch(db);

                processedOrdersData.forEach(order => {
                    const docRef = doc(db, "users", userId, "processedOrders", order.orderId);
                    const dataToSave = {
                        orderId: order.orderId,
                        cost: order.cost,
                        isAffiliate: order.isAffiliate,
                        items: order.items.map(item => ({
                            productName: item.matchedProduct.Product_Name,
                            quantity: item.quantity
                        })),
                        savedAt: serverTimestamp()
                    };
                    batch.set(docRef, dataToSave, { merge: true });
                });

                await batch.commit();
                showNotification(`✅ Successfully processed and saved ${processedOrdersData.length} orders!`);
            } else if (processedOrdersData.length > 0) {
                 showNotification("Orders processed, but could not save to cloud (not connected).", true);
            }

        } catch (error) {
            console.error("An error occurred during processing:", error);
            alert(`Error: ${error.message}`);
            showNotification(`❌ Error: ${error.message}`, true);
        } finally {
            uiStopLoading('daily');
        }
    }, 100);
}

/**
 * Handles the weekly profit calculation workflow by reading an .xlsx file.
 */
async function handleWeeklyAudit() {
    const file = weeklyReportFile.files[0];
    if (!file) {
        alert("Please upload the weekly report file first.");
        return;
    }

    uiStartLoading('weekly');

    setTimeout(() => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                
                const reportData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

                if (reportData.length < 2) {
                    throw new Error("The uploaded spreadsheet is empty or has no data rows.");
                }
                
                const headers = reportData[0];
                const orderIdIndex = headers.findIndex(h => h && h.trim() === "Order/adjustment ID");
                const settlementIndex = headers.findIndex(h => h && h.trim() === "Total settlement amount");

                if (orderIdIndex === -1) throw new Error(`Could not find a column named "Order/adjustment ID".`);
                if (settlementIndex === -1) throw new Error(`Could not find a column named "Total settlement amount".`);

                let totalWeeklyProfit = 0, totalWeeklyCost = 0, foundMatches = 0;
                weeklyResultsData = [];
                const dataRows = reportData.slice(1);

                for (const row of dataRows) {
                    const orderId = String(row[orderIdIndex]).trim();
                    const settlementAmount = parseFloat(row[settlementIndex]);

                    if (!orderId || isNaN(settlementAmount)) continue;

                    const q = query(collectionGroup(db, "processedOrders"), where("orderId", "==", orderId));
                    const cgSnap = await getDocs(q);

                    if (!cgSnap.empty) {
                        foundMatches++;
                        let chosenDoc = cgSnap.docs[0];
                        chosenDoc = cgSnap.docs.reduce((best, d) => {
                            const a = d.data().savedAt;
                            const at = a && typeof a.toDate === 'function' ? a.toDate().getTime() : 0;
                            const bData = best.data();
                            const bt = bData.savedAt && typeof bData.savedAt.toDate === 'function' ? bData.savedAt.toDate().getTime() : 0;
                            return at > bt ? d : best;
                        }, chosenDoc);

                        const savedOrder = chosenDoc.data();
                        const profit = settlementAmount - savedOrder.cost;
                        totalWeeklyProfit += profit;
                        totalWeeklyCost += savedOrder.cost;

                        weeklyResultsData.push({
                            orderId: savedOrder.orderId,
                            products: savedOrder.items.map(item => `${item.productName} (x${item.quantity})`).join(', '),
                            settlement: settlementAmount,
                            cost: savedOrder.cost,
                            profit: profit,
                            uploadedAt: savedOrder.savedAt && typeof savedOrder.savedAt.toDate === 'function'
                                ? savedOrder.savedAt.toDate()
                                : (savedOrder.savedAt ? new Date(savedOrder.savedAt) : null)
                        });
                    }
                }
                
                showNotification(`Found ${foundMatches} matching orders in the database.`);
                displayWeeklyResults(weeklyResultsData, totalWeeklyProfit, totalWeeklyCost, foundMatches);
            } catch (error) {
                console.error("Error processing weekly report:", error);
                alert(`Error: ${error.message}`);
            } finally {
                uiStopLoading('weekly');
            }
        };
        reader.readAsArrayBuffer(file);
    }, 100);
}

// ===================================
// == DATA HANDLING
// ===================================

/**
 * Parses the product data from a CSV string into a usable format.
 */
function parseProductSheet(csvString) {
    const workbook = XLSX.read(csvString.trim(), { type: 'string' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const products = XLSX.utils.sheet_to_json(sheet);
    // Sort by keyword length to match longer, more specific names first
    products.sort((a, b) => (b.Matching_Keywords || '').length - (a.Matching_Keywords || '').length);
    const skuMap = new Map(products.map(p => [p.SKU, p]));
    return { products, skuMap };
}

/**
 * Parses orders by searching for known product names within each block of text.
 */
function parseOrders(text, productData) {
    const parsedOrders = [];
    const orderBlocks = text.split(/รหัสคำสั่งซื้อ\s*[:：]?\s*/).slice(1);

    for (const block of orderBlocks) {
        try {
            const orderIdRegex = /^\s*(\d+)/;
            const salePriceRegex = /฿\s*([\d,]+\.?\d*)/g;
            const orderIdMatch = block.match(orderIdRegex);
            const priceMatches = [...block.matchAll(salePriceRegex)];

            if (!orderIdMatch || priceMatches.length === 0) {
                console.warn("Skipping block: Could not find Order ID or Sale Price.", block);
                continue;
            }

            const orderId = orderIdMatch[1].trim();
            const lastPriceMatch = priceMatches[priceMatches.length - 1];
            const salePrice = parseFloat(String(lastPriceMatch[1]).replace(/,/g, ''));
            const isAffiliate = block.includes('ครีเอเตอร์แอฟฟิลิเอต');
            const items = [];
            let foundProducts = [];

            for (const product of productData.products) {
                if (block.includes(product.Matching_Keywords)) {
                    foundProducts.push(product);
                }
            }

            // Filter out sub-matches (e.g., if both "ครีมซอง" and "ครีมซอง 6 ซอง" match, keep only the longer one)
            const finalProducts = foundProducts.filter(productA => 
                !foundProducts.some(productB => 
                    productA.Matching_Keywords !== productB.Matching_Keywords && 
                    productB.Matching_Keywords.includes(productA.Matching_Keywords)
                )
            );
            
            for (const product of finalProducts) {
                const productNameIndex = block.indexOf(product.Matching_Keywords);
                const searchArea = block.substring(productNameIndex);
                let quantity = 0;

                // Common qty formats: "× 3", "x3", "X 3", "3 ชิ้น", "3 ก้อน"
                const qtyPatterns = [
                    /[×xX]\s*(\d+)/,
                    /(\d+)\s*(?:ชิ้น|ก้อน)/
                ];
                for (const qp of qtyPatterns) {
                    const m = searchArea.match(qp);
                    if (m) { quantity = parseInt(m[1], 10); break; }
                }

                if (quantity === 0) {
                    quantity = 1; // default to 1 if quantity not explicitly stated
                }

                items.push({ productName: product.Matching_Keywords, quantity });
            }

            if (items.length > 0) {
                parsedOrders.push({ orderId, salePrice, items, isAffiliate });
            }

        } catch (e) {
            console.error("An error occurred while parsing an order block:", e);
        }
    }
    return parsedOrders;
}

/**
 * Finds the correct product and calculates its cost, handling bundles.
 */
function findProductCost(orderProductName, { products, skuMap }) {
    const bestMatch = products.find(p => p.Matching_Keywords === orderProductName);
    if (bestMatch) {
        let totalCost = 0;
        if (bestMatch.Bundle_Components) {
            const componentSKUs = String(bestMatch.Bundle_Components).split(',').map(s => s.trim());
            for (const sku of componentSKUs) {
                if (skuMap.has(sku)) {
                    totalCost += parseFloat(skuMap.get(sku).Cost_Price);
                }
            }
        } else {
            totalCost = parseFloat(bestMatch.Cost_Price);
        }
        return { cost: totalCost, matchedProduct: bestMatch };
    }
    return null;
}

// ===================================
// == FIREBASE FUNCTIONS
// ===================================

/**
 * Loads product data from Firestore or creates it from default if it doesn't exist.
 */
async function loadDataFromFirestore() {
    if (!auth.currentUser) {
        showNotification('❌ Not connected to the database. Please refresh.', true);
        return;
    }
    const userId = auth.currentUser.uid;
    const docRef = doc(db, 'productData', userId);
    try {
        const docSnap = await getDoc(docRef);
        if (docSnap.exists() && docSnap.data().products && docSnap.data().products.length > 0) {
            const products = docSnap.data().products;
            masterProductData = {
                products,
                skuMap: new Map(products.map(p => [p.SKU, p]))
            };
            showNotification('✅ Loaded saved data from cloud.');
        } else {
            masterProductData = parseProductSheet(productCSVData);
            try {
                await saveMasterDataToFirestore();
                showNotification('No saved data found. Loaded default data and saved to cloud.');
            } catch (e) {
                console.warn('Could not save default data to cloud (will use local only).');
            }
        }
    } catch (e) {
        console.error('Error loading product data from Firestore; using local defaults:', e);
        masterProductData = parseProductSheet(productCSVData);
        showNotification('❌ Could not read cloud data. Using local defaults.', true);
    }
    renderProductTable(false);
}

/**
 * Reads data from the editable table and saves it to Firestore.
 */
async function updateAndSaveFromDOM() {
    if (!auth.currentUser) {
        alert("Cannot save. Not connected to the database.");
        return;
    }
    const tableRows = productDataTableContainer.querySelectorAll('tbody tr');
    const updatedProducts = [];
    tableRows.forEach(row => {
        const sku = row.dataset.sku;
        const productToUpdate = { SKU: sku };
        row.querySelectorAll('input[data-key]').forEach(input => {
            productToUpdate[input.dataset.key] = input.value;
        });
        updatedProducts.push(productToUpdate);
    });
    masterProductData.products = updatedProducts;
    await saveMasterDataToFirestore();
    renderProductTable(false);
    uiEndEditMode();
}

/**
 * Saves the current masterProductData object to Firestore.
 */
async function saveMasterDataToFirestore() {
    const userId = auth.currentUser.uid;
    const docRef = doc(db, 'productData', userId);
    try {
        await setDoc(docRef, { products: masterProductData.products });
        showNotification('✅ Product data saved to cloud!');
    } catch (error) {
        console.error("Error saving data to Firestore: ", error);
        showNotification('❌ Error saving data to cloud.', true);
    }
}

/**
 * Resets the data in Firestore to the default data from data.js.
 */
async function resetProductData() {
    if (!auth.currentUser) {
        alert("Cannot reset. Not connected to the database.");
        return;
    }
    if (confirm("Are you sure you want to reset your data to the default? This will overwrite your cloud data.")) {
        masterProductData = parseProductSheet(productCSVData);
        await saveMasterDataToFirestore();
        renderProductTable(false);
    }
}

// ===================================
// == UI / VIEW FUNCTIONS
// ===================================

/**
 * Displays a warning modal with the IDs of collapsed orders.
 */
function displayCollapsedOrderWarning(orderIds) {
    collapsedOrderList.innerHTML = ''; // Clear previous list
    orderIds.forEach(id => {
        const li = document.createElement('li');
        li.textContent = `Order ID: ${id}`;
        collapsedOrderList.appendChild(li);
    });
    collapsedOrderModal.classList.remove('hidden');
}

/**
 * Shows loading indicators and disables buttons.
 */
function uiStartLoading(type) {
    const bar = type === 'weekly' ? weeklyProgressBar : dailyProgressBar;
    const container = type === 'weekly' ? weeklyLoadingDiv : dailyLoadingDiv;
    bar.style.transitionDuration = '0s';
    bar.style.width = '0%';
    container.classList.remove('hidden');
    setTimeout(() => {
        bar.style.transitionDuration = '0.5s';
        bar.style.width = '90%';
    }, 10);
    resultsSection.classList.add('hidden');
    weeklyResultsSection.classList.add('hidden');
    processBtn.disabled = true;
    copyBtn.disabled = true;
    calculateProfitBtn.disabled = true;
    resultsTableBody.innerHTML = '';
}

/**
 * Hides loading indicators and re-enables buttons.
 */
function uiStopLoading() {
    const bars = [dailyProgressBar, weeklyProgressBar];
    bars.forEach(bar => {
        bar.style.transitionDuration = '0.3s';
        bar.style.width = '100%';
    });
    setTimeout(() => {
        dailyLoadingDiv.classList.add('hidden');
        weeklyLoadingDiv.classList.add('hidden');
        processBtn.disabled = false;
        calculateProfitBtn.disabled = false;
        if (processedOrdersData.length > 0) copyBtn.disabled = false;
        if (weeklyResultsData.length > 0) copyWeeklyBtn.disabled = false;
    }, 500);
}

/**
 * Switches the product data table to edit mode.
 */
function uiStartEditMode() {
    renderProductTable(true);
    editDataBtn.classList.add('hidden');
    saveDataBtn.classList.remove('hidden');
    cancelDataBtn.classList.remove('hidden');
    resetDataBtn.classList.add('hidden');
}

/**
 * Switches the product data table to view mode.
 */
function uiEndEditMode() {
    renderProductTable(false);
    editDataBtn.classList.remove('hidden');
    saveDataBtn.classList.add('hidden');
    cancelDataBtn.classList.add('hidden');
    resetDataBtn.classList.remove('hidden');
}

/**
 * Renders the daily audit results into the summary cards and the main table.
 */
function displayResults(orders) {
    const totalRevenue = orders.reduce((sum, order) => sum + order.salePrice, 0);
    const totalCost = orders.reduce((sum, order) => sum + order.cost, 0);
    const formatCurrency = (num) => `฿${num.toFixed(2)}`;
    totalRevenueEl.textContent = formatCurrency(totalRevenue);
    totalCostEl.textContent = formatCurrency(totalCost);
    totalOrdersEl.textContent = orders.length;
    resultsTableBody.innerHTML = '';
    orders.forEach((order, index) => {
        const row = document.createElement('tr');
        row.className = 'hover:bg-gray-50';
        const productCellContent = order.items.map(item => `${item.matchedProduct.Product_Name} (x${item.quantity})`).join('<br>');
        const totalQuantity = order.items.reduce((sum, item) => sum + item.quantity, 0);
        const imageContainer = document.createElement('div');
        imageContainer.className = 'flex flex-col space-y-1';
        order.items.forEach(item => {
            const imageUrl = item.matchedProduct.Image_URL || 'https://placehold.co/40x40/EEE/333?text=N/A';
            const img = document.createElement('img');
            img.src = imageUrl;
            img.alt = "Product Image";
            img.className = "h-10 w-10 object-cover rounded";
            imageContainer.appendChild(img);
        });
        const affiliateStar = order.isAffiliate ? ' ⭐' : '';
        row.innerHTML = `
            <td class="px-4 py-3 text-sm text-gray-800">${index + 1}</td>
            <td class="px-4 py-3"></td>
            <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-800">${order.orderId}${affiliateStar}</td>
            <td class="px-4 py-3 text-sm text-gray-600">${productCellContent}</td>
            <td class="px-4 py-3 text-sm text-gray-800 text-center">${totalQuantity}</td>
            <td class="px-4 py-3 text-sm text-gray-800">${formatCurrency(order.salePrice)}</td>
            <td class="px-4 py-3 text-sm text-red-600">${formatCurrency(order.cost)}</td>
        `;
        row.cells[1].appendChild(imageContainer);
        resultsTableBody.appendChild(row);
    });
    resultsSection.classList.remove('hidden');
}

/**
 * Renders the weekly profit results into its dedicated table.
 */
function displayWeeklyResults(results, totalProfit, totalCost, orderCount) {
    const formatCurrency = (num) => `฿${num.toFixed(2)}`;
    totalWeeklyProfitEl.textContent = formatCurrency(totalProfit);
    totalWeeklyCostEl.textContent = formatCurrency(totalCost);
    totalWeeklyOrdersEl.textContent = orderCount;
    weeklyResultsTableBody.innerHTML = '';
    results.forEach((result, index) => {
        const uploadedDisplay = result.uploadedAt
            ? new Date(result.uploadedAt).toLocaleString()
            : '';
        const row = document.createElement('tr');
        row.className = 'hover:bg-gray-50';
        row.innerHTML = `
            <td class="px-4 py-3 text-sm text-gray-800">${index + 1}</td>
            <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-800">${result.orderId}</td>
            <td class="px-4 py-3 text-sm text-gray-600">${uploadedDisplay}</td>
            <td class="px-4 py-3 text-sm text-gray-600">${result.products}</td>
            <td class="px-4 py-3 text-sm text-gray-800">${formatCurrency(result.settlement)}</td>
            <td class="px-4 py-3 text-sm text-red-600">${formatCurrency(result.cost)}</td>
            <td class="px-4 py-3 text-sm font-bold ${result.profit >= 0 ? 'text-green-600' : 'text-red-700'}">${formatCurrency(result.profit)}</td>
            
        `;
        weeklyResultsTableBody.appendChild(row);
    });
    weeklyResultsSection.classList.remove('hidden');
    copyWeeklyBtn.disabled = false;
}

/**
 * Generates a clean HTML version of the daily report and copies it to the clipboard.
 */
function copyReportToClipboard() {
    if (processedOrdersData.length === 0) {
        alert("No data to copy. Please process orders first.");
        return;
    }
    const formatCurrency = (num) => `฿${num.toFixed(2)}`;
    const totalRevenue = processedOrdersData.reduce((sum, order) => sum + order.salePrice, 0);
    const totalCost = processedOrdersData.reduce((sum, order) => sum + order.cost, 0);
    let htmlString = `
        <style>
            table { font-family: 'Prompt', sans-serif; font-size: 10pt; border-collapse: collapse; width: 100%; }
            th, td { border: 1px solid #dddddd; text-align: left; padding: 5px; vertical-align: top; }
            th { background-color: #f2f2f2; }
        </style>
        <h1>Sales Audit Summary</h1>
        <p><strong>Total Revenue:</strong> ${formatCurrency(totalRevenue)}</p>
        <p><strong>Total Cost:</strong> ${formatCurrency(totalCost)}</p>
        <p><strong>Total Orders:</strong> ${processedOrdersData.length}</p>
        <br>
        <table>
            <thead>
                <tr>
                    <th>#</th><th>Image</th><th>Order ID</th><th>Product</th><th>Qty</th><th>Sale Price</th><th>Total Cost</th>
                </tr>
            </thead>
            <tbody>`;

    processedOrdersData.forEach((order, index) => {
        const productCellContent = order.items.map(item => `${item.matchedProduct.Product_Name} (x${item.quantity})`).join('<br>');
        const totalQuantity = order.items.reduce((sum, item) => sum + item.quantity, 0);
        const imageCellContent = order.items.map(item => `<img src="${item.matchedProduct.Image_URL || 'https://placehold.co/40x40/EEE/333?text=N/A'}" width="40" height="40">`).join('<br>');
        const affiliateStar = order.isAffiliate ? ' ⭐' : '';
        htmlString += `
            <tr>
                <td>${index + 1}</td>
                <td>${imageCellContent}</td>
                <td>${order.orderId}${affiliateStar}</td>
                <td>${productCellContent}</td>
                <td>${totalQuantity}</td>
                <td>${formatCurrency(order.salePrice)}</td>
                <td>${formatCurrency(order.cost)}</td>
            </tr>`;
    });
    htmlString += `</tbody></table>`;
    
    // Use a temporary element to copy the rich text
    const tempEl = document.createElement('div');
    tempEl.style.position = 'absolute';
    tempEl.style.left = '-9999px';
    tempEl.innerHTML = htmlString;
    document.body.appendChild(tempEl);
    const range = document.createRange();
    range.selectNode(tempEl);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    try {
        document.execCommand('copy');
        showNotification('✅ Report copied to clipboard!');
    } catch (err) {
        console.error('Failed to copy text: ', err);
        showNotification('❌ Failed to copy report.', true);
    }
    document.body.removeChild(tempEl);
}

/**
 * Generates a clean HTML version of the weekly report and copies it to the clipboard.
 */
function copyWeeklyReportToClipboard() {
    if (weeklyResultsData.length === 0) {
        alert("No weekly data to copy.");
        return;
    }
    const formatCurrency = (num) => `฿${num.toFixed(2)}`;
    const totalProfit = weeklyResultsData.reduce((sum, result) => sum + result.profit, 0);
    const totalCost = weeklyResultsData.reduce((sum, result) => sum + result.cost, 0);
    let htmlString = `
        <style>
            table { font-family: 'Prompt', sans-serif; font-size: 10pt; border-collapse: collapse; width: 100%; }
            th, td { border: 1px solid #dddddd; text-align: left; padding: 5px; }
            th { background-color: #f2f2f2; }
        </style>
        <h1>Weekly Profit Summary</h1>
        <p><strong>Total Weekly Profit:</strong> ${formatCurrency(totalProfit)}</p>
        <p><strong>Total Cost:</strong> ${formatCurrency(totalCost)}</p>
        <p><strong>Total Orders Found:</strong> ${weeklyResultsData.length}</p>
        <br>
        <table>
            <thead>
                <tr>
                    <th>#</th><th>Order ID</th><th>Uploaded At</th><th>Product</th><th>Total Settlement</th><th>Cost</th><th>Profit</th>
                </tr>
            </thead>
            <tbody>`;

    weeklyResultsData.forEach((result, index) => {
      const uploadedDisplay = result.uploadedAt
            ? new Date(result.uploadedAt).toLocaleString()
            : '';
        htmlString += `
            <tr>
                <td>${index + 1}</td>
                <td>${result.orderId}</td>
                <td>${uploadedDisplay}</td>
                <td>${result.products}</td>
                <td>${formatCurrency(result.settlement)}</td>
                <td>${formatCurrency(result.cost)}</td>
                <td>${formatCurrency(result.profit)}</td>
            </tr>`;
    });
    htmlString += `</tbody></table>`;

    const tempEl = document.createElement('div');
    tempEl.style.position = 'absolute';
    tempEl.style.left = '-9999px';
    tempEl.innerHTML = htmlString;
    document.body.appendChild(tempEl);
    const range = document.createRange();
    range.selectNode(tempEl);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    try {
        document.execCommand('copy');
        showNotification('✅ Weekly report copied to clipboard!');
    } catch (err) {
        console.error('Failed to copy text: ', err);
        showNotification('❌ Failed to copy report.', true);
    }
    document.body.removeChild(tempEl);
}

/**
 * Renders the product data table, either as static text or as editable inputs.
 */
function renderProductTable(isEditable = false) {
    const table = document.createElement('table');
    table.className = 'min-w-full bg-white border border-gray-200';
    const thead = document.createElement('thead');
    thead.className = 'bg-gray-50';
    thead.innerHTML = `
        <tr>
            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">SKU</th>
            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Product Name</th>
            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Matching Keywords</th>
            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cost Price</th>
            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Image URL</th>
            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Bundle Components</th>
        </tr>
    `;
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    tbody.className = 'divide-y divide-gray-200';

    masterProductData.products.forEach(product => {
        const row = document.createElement('tr');
        row.dataset.sku = product.SKU;
        if (isEditable) {
            row.innerHTML = `
                <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-800">${product.SKU}</td>
                <td class="px-2 py-1"><input type="text" data-key="Product_Name" class="w-full p-1 border rounded" value="${product.Product_Name || ''}"></td>
                <td class="px-2 py-1"><input type="text" data-key="Matching_Keywords" class="w-full p-1 border rounded" value="${product.Matching_Keywords || ''}"></td>
                <td class="px-2 py-1"><input type="text" data-key="Cost_Price" class="w-24 p-1 border rounded" value="${product.Cost_Price || ''}"></td>
                <td class="px-2 py-1"><input type="text" data-key="Image_URL" class="w-full p-1 border rounded" value="${product.Image_URL || ''}"></td>
                <td class="px-2 py-1"><input type="text" data-key="Bundle_Components" class="w-full p-1 border rounded" value="${product.Bundle_Components || ''}"></td>
            `;
        } else {
            row.innerHTML = `
                <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-800">${product.SKU}</td>
                <td class="px-4 py-3 text-sm text-gray-600">${product.Product_Name || ''}</td>
                <td class="px-4 py-3 text-sm text-gray-600">${product.Matching_Keywords || ''}</td>
                <td class="px-4 py-3 text-sm text-gray-800">${product.Cost_Price || ''}</td>
                <td class="px-4 py-3 text-sm text-gray-600">${product.Image_URL || ''}</td>
                <td class="px-4 py-3 text-sm text-gray-600">${product.Bundle_Components || ''}</td>
            `;
        }
        tbody.appendChild(row);
    });
    table.appendChild(tbody);
    productDataTableContainer.innerHTML = '';
    productDataTableContainer.appendChild(table);
}

/**
 * Shows a temporary popup notification to the user.
 */
function showNotification(message, isError = false) {
    notificationPopup.textContent = message;
    notificationPopup.className = `fixed bottom-5 right-5 text-white py-3 px-5 rounded-lg shadow-lg transition-opacity duration-500 opacity-0 ${isError ? 'bg-red-500' : 'bg-green-500'}`;
    notificationPopup.classList.remove('hidden');
    setTimeout(() => notificationPopup.classList.remove('opacity-0'), 10);
    setTimeout(() => {
        notificationPopup.classList.add('opacity-0');
        setTimeout(() => notificationPopup.classList.add('hidden'), 500);
    }, 3000);
}

/**
 * Handles switching between the main application tabs.
 */
function switchTab(activeTabId) {
    const tabs = [
        { id: 'daily', tabEl: dailyAuditTab, panelEl: dailyAuditPanel },
        { id: 'weekly', tabEl: weeklyAuditTab, panelEl: weeklyAuditPanel },
        { id: 'data', tabEl: productDataTab, panelEl: productDataPanel }
    ];

    tabs.forEach(tab => {
        if (tab.id === activeTabId) {
            tab.tabEl.classList.add('border-indigo-500', 'text-indigo-600');
            tab.tabEl.classList.remove('border-transparent', 'hover:text-gray-600', 'hover:border-gray-300');
            tab.panelEl.classList.remove('hidden');
        } else {
            tab.tabEl.classList.add('border-transparent', 'hover:text-gray-600', 'hover:border-gray-300');
            tab.tabEl.classList.remove('border-indigo-500', 'text-indigo-600');
            tab.panelEl.classList.add('hidden');
        }
    });
}

// ===================================
// == INITIALIZATION
// ===================================

/**
 * Initializes the application, sets up Firebase, and attaches event listeners.
 */
async function initialize() {
    orderTextArea.value = sampleOrders;
    
    // Set up Firebase connection
    try {
        const app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
        await signInAnonymously(auth);
        onAuthStateChanged(auth, async user => {
            if (user) {
                showNotification('☁️ Connected to cloud database...');
                await loadDataFromFirestore();
            }
        });
    } catch (e) {
        console.error("Firebase initialization failed:", e);
        showNotification('❌ Cloud connection failed. Using local data.', true);
        masterProductData = parseProductSheet(productCSVData);
        renderProductTable(false);
    }
    
    // Attach main event listeners
    processBtn.addEventListener('click', handleProcessOrders);
    copyBtn.addEventListener('click', copyReportToClipboard);
    calculateProfitBtn.addEventListener('click', handleWeeklyAudit);
    copyWeeklyBtn.addEventListener('click', copyWeeklyReportToClipboard);
    copyBtn.disabled = true;
    copyWeeklyBtn.disabled = true;

    // Attach listeners for the product data editor
    editDataBtn.addEventListener('click', uiStartEditMode);
    saveDataBtn.addEventListener('click', updateAndSaveFromDOM);
    cancelDataBtn.addEventListener('click', uiEndEditMode);
    resetDataBtn.addEventListener('click', resetProductData);

    // Attach listener for the new modal
    closeModalBtn.addEventListener('click', () => {
        collapsedOrderModal.classList.add('hidden');
    });

    // Attach listeners for tab navigation
    dailyAuditTab.addEventListener('click', () => switchTab('daily'));
    weeklyAuditTab.addEventListener('click', () => switchTab('weekly'));
    productDataTab.addEventListener('click', () => switchTab('data'));

    // Set the initial active tab
    switchTab('daily');
}

// Start the application
initialize();


