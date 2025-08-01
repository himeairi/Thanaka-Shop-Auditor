import { productCSVData, sampleOrders } from './data.js';

// ===================================
// == FIREBASE SDK IMPORTS
// ===================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, writeBatch } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-firestore.js";

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
// The saveOrdersBtn is no longer needed but we keep the reference to avoid errors if the HTML isn't updated yet.
const saveOrdersBtn = document.getElementById('save-orders-btn');
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
 * Main controller to handle the order processing and saving workflow.
 * MODIFIED: This function now automatically saves the processed orders to Firestore.
 */
async function handleProcessOrders() {
    processedOrdersData = [];
    uiStartLoading('daily');
    
    setTimeout(async () => {
        const orderText = orderTextArea.value;
        if (!orderText.trim()) {
            alert("Please paste your order text.");
            uiStopLoading('daily');
            return;
        }

        try {
            const orders = parseOrders(orderText, masterProductData);

            if (orders.length === 0) {
                throw new Error("Could not parse any orders. Please check the text format and ensure product names in the pre-loaded data are correct.");
            }
            
            // Process each order to calculate cost
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

            // Display the results on the screen
            displayResults(processedOrdersData);

            // --- NEW: AUTOMATICALLY SAVE TO CLOUD ---
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
                        savedAt: new Date()
                    };
                    batch.set(docRef, dataToSave, { merge: true });
                });

                await batch.commit();
                showNotification(`✅ Successfully processed and saved ${processedOrdersData.length} orders!`);
            } else if (processedOrdersData.length > 0) {
                 showNotification("Orders processed, but could not save to cloud (not connected).", true);
            }
            // --- END OF NEW LOGIC ---

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
 * Handles the weekly profit calculation workflow.
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
                console.log("Spreadsheet Headers:", headers);

                const orderIdIndex = headers.findIndex(h => h && h.trim() === "Order/adjustment ID");
                const settlementIndex = headers.findIndex(h => h && h.trim() === "Total settlement amount");

                if (orderIdIndex === -1) {
                     throw new Error(`Could not find a column named exactly "Order/adjustment ID". Please check the spreadsheet.`);
                }
                if (settlementIndex === -1) {
                     throw new Error(`Could not find a column named exactly "Total settlement amount". Please check the spreadsheet.`);
                }

                let totalWeeklyProfit = 0;
                let totalWeeklyCost = 0;
                weeklyResultsData = [];
                let foundMatches = 0;

                const dataRows = reportData.slice(1);

                for (const row of dataRows) {
                    const orderId = String(row[orderIdIndex]).trim();
                    const settlementAmount = parseFloat(row[settlementIndex]);

                    if (!orderId || isNaN(settlementAmount)) {
                        continue; 
                    }
                    
                    const savedOrderDoc = await getDoc(doc(db, "users", auth.currentUser.uid, "processedOrders", orderId));

                    if (savedOrderDoc.exists()) {
                        foundMatches++;
                        const savedOrder = savedOrderDoc.data();
                        const profit = settlementAmount - savedOrder.cost;
                        totalWeeklyProfit += profit;
                        totalWeeklyCost += savedOrder.cost;
                        
                        weeklyResultsData.push({
                            orderId: savedOrder.orderId,
                            products: savedOrder.items.map(item => `${item.productName} (x${item.quantity})`).join(', '),
                            settlement: settlementAmount,
                            cost: savedOrder.cost,
                            profit: profit
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
 * @param {string} csvString - The CSV data as a string.
 * @returns {{products: Array<Object>, skuMap: Map<string, Object>}}
 */
function parseProductSheet(csvString) {
    const workbook = XLSX.read(csvString.trim(), { type: 'string' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const products = XLSX.utils.sheet_to_json(sheet);
    products.sort((a, b) => (b.Matching_Keywords || '').length - (a.Matching_Keywords || '').length);
    const skuMap = new Map(products.map(p => [p.SKU, p]));
    return { products, skuMap };
}

/**
 * Parses orders by searching for known product names within each block of text.
 * @param {string} text - The raw text from the textarea.
 * @param {Object} productData - The pre-loaded product data.
 * @returns {Array<Object>} An array of structured order objects, where each object can contain multiple items.
 */
function parseOrders(text, productData) {
    const parsedOrders = [];
    const orderBlocks = text.split(/รหัสคำสั่งซื้อ:/).slice(1);

    for (const block of orderBlocks) {
        try {
            const orderIdRegex = /^\s*(\d+)/;
            const salePriceRegex = /฿\s*([\d,]+\.?\d*)/;

            const orderIdMatch = block.match(orderIdRegex);
            const salePriceMatch = block.match(salePriceRegex);

            if (!orderIdMatch || !salePriceMatch) {
                console.warn("Skipping block: Could not find Order ID or Sale Price.", block);
                continue;
            }

            const orderId = orderIdMatch[1].trim();
            const salePrice = parseFloat(salePriceMatch[1].replace(/,/g, ''));
            const isAffiliate = block.includes('ครีเอเตอร์แอฟฟิลิเอต');
            const items = [];

            let foundProducts = [];
            for (const product of productData.products) {
                if (block.includes(product.Matching_Keywords)) {
                    foundProducts.push(product);
                }
            }

            const finalProducts = foundProducts.filter(productA => {
                return !foundProducts.some(productB => 
                    productA.Matching_Keywords !== productB.Matching_Keywords && 
                    productB.Matching_Keywords.includes(productA.Matching_Keywords)
                );
            });
            
            for (const product of finalProducts) {
                const productNameIndex = block.indexOf(product.Matching_Keywords);
                const searchArea = block.substring(productNameIndex);
                
                let quantity = 0;

                const specialSoapSKUs = ['tan_soap', 'pom_soap'];
                if (specialSoapSKUs.includes(product.SKU)) {
                    const specialQtyMatch = searchArea.match(/(\d+)\s*ก้อน/);
                    if (specialQtyMatch) {
                        quantity = parseInt(specialQtyMatch[1], 10);
                    }
                }

                if (quantity === 0) {
                    const quantityMatch = searchArea.match(/×\s*(\d+)/);
                    if (quantityMatch) {
                        quantity = parseInt(quantityMatch[1], 10);
                    }
                }
                
                if (quantity > 0) {
                    items.push({
                        productName: product.Matching_Keywords,
                        quantity: quantity
                    });
                }
            }

            if (items.length > 0) {
                parsedOrders.push({
                    orderId,
                    salePrice,
                    items,
                    isAffiliate // Add the affiliate flag
                });
            }

        } catch (e) {
            console.error("An error occurred while parsing an order block:", e);
        }
    }
    return parsedOrders;
}


/**
 * Finds the correct product and calculates its cost.
 * @param {string} orderProductName - The product name from the parsed order.
 * @param {{products: Array<Object>, skuMap: Map<string, Object>}} productData
 * @returns {Object|null}
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
        await saveMasterDataToFirestore();
        showNotification('No saved data found. Loaded default data and saved to cloud.');
    }
    renderProductTable(false);
}

/**
 * Reads data from the editable table and saves it to Firestore.
 */
async function updateAndSaveFromDOM() {
    if (!auth.currentUser) {
        alert("Cannot save. Not connected to the database. Please refresh the page and try again.");
        return;
    }

    const tableRows = productDataTableContainer.querySelectorAll('tbody tr');
    const updatedProducts = [];
    tableRows.forEach(row => {
        const sku = row.dataset.sku;
        const productToUpdate = { SKU: sku };
        row.querySelectorAll('input[data-key]').forEach(input => {
            const key = input.dataset.key;
            productToUpdate[key] = input.value;
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
        alert("Cannot reset. Not connected to the database. Please refresh the page and try again.");
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
    // REMOVED: saveOrdersBtn.disabled = true;
    calculateProfitBtn.disabled = true;
    resultsTableBody.innerHTML = '';
}

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
        if (processedOrdersData.length > 0) {
            copyBtn.disabled = false;
            // REMOVED: saveOrdersBtn.disabled = false;
        }
        if(weeklyResultsData.length > 0) {
            copyWeeklyBtn.disabled = false;
        }
    }, 500);
}

function uiStartEditMode() {
    renderProductTable(true);
    editDataBtn.classList.add('hidden');
    saveDataBtn.classList.remove('hidden');
    cancelDataBtn.classList.remove('hidden');
    resetDataBtn.classList.add('hidden');
}

function uiEndEditMode() {
    renderProductTable(false);
    editDataBtn.classList.remove('hidden');
    saveDataBtn.classList.add('hidden');
    cancelDataBtn.classList.add('hidden');
    resetDataBtn.classList.remove('hidden');
}

/**
 * Renders the results into the summary cards and the main table.
 * @param {Array<Object>} orders
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
 * @param {Array<Object>} results
 * @param {number} totalProfit
 * @param {number} totalCost
 * @param {number} orderCount
 */
function displayWeeklyResults(results, totalProfit, totalCost, orderCount) {
    const formatCurrency = (num) => `฿${num.toFixed(2)}`;
    totalWeeklyProfitEl.textContent = formatCurrency(totalProfit);
    totalWeeklyCostEl.textContent = formatCurrency(totalCost);
    totalWeeklyOrdersEl.textContent = orderCount;

    weeklyResultsTableBody.innerHTML = '';
    results.forEach((result, index) => {
        const row = document.createElement('tr');
        row.className = 'hover:bg-gray-50';
        row.innerHTML = `
            <td class="px-4 py-3 text-sm text-gray-800">${index + 1}</td>
            <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-800">${result.orderId}</td>
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
                    <th>#</th>
                    <th>Image</th>
                    <th>Order ID</th>
                    <th>Product</th>
                    <th>Qty</th>
                    <th>Sale Price</th>
                    <th>Total Cost</th>
                </tr>
            </thead>
            <tbody>
    `;

    processedOrdersData.forEach((order, index) => {
        const productCellContent = order.items.map(item => `${item.matchedProduct.Product_Name} (x${item.quantity})`).join('<br>');
        const totalQuantity = order.items.reduce((sum, item) => sum + item.quantity, 0);
        const imageCellContent = order.items.map(item => {
            const imageUrl = item.matchedProduct.Image_URL || 'https://placehold.co/40x40/EEE/333?text=N/A';
            return `<img src="${imageUrl}" width="40" height="40">`;
        }).join('<br>');
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
            </tr>
        `;
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
        alert("No weekly data to copy. Please calculate the weekly profit first.");
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
                    <th>#</th>
                    <th>Order ID</th>
                    <th>Product</th>
                    <th>Total Settlement</th>
                    <th>Cost</th>
                    <th>Profit</th>
                </tr>
            </thead>
            <tbody>
    `;

    weeklyResultsData.forEach((result, index) => {
        htmlString += `
            <tr>
                <td>${index + 1}</td>
                <td>${result.orderId}</td>
                <td>${result.products}</td>
                <td>${formatCurrency(result.settlement)}</td>
                <td>${formatCurrency(result.cost)}</td>
                <td>${formatCurrency(result.profit)}</td>
            </tr>
        `;
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
 * Renders the product data table.
 * @param {boolean} isEditable - If true, renders inputs; otherwise, text.
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
 * Shows a temporary popup to notify the user.
 * @param {string} message - The message to display.
 * @param {boolean} isError - If true, shows a red error popup.
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

async function initialize() {
    orderTextArea.value = sampleOrders;
    
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
    
    // MODIFIED: Removed the event listener for saveOrdersBtn
    processBtn.addEventListener('click', handleProcessOrders);
    copyBtn.addEventListener('click', copyReportToClipboard);
    calculateProfitBtn.addEventListener('click', handleWeeklyAudit);
    copyWeeklyBtn.addEventListener('click', copyWeeklyReportToClipboard);

    // MODIFIED: The saveOrdersBtn is no longer used
    copyBtn.disabled = true;
    copyWeeklyBtn.disabled = true;

    editDataBtn.addEventListener('click', uiStartEditMode);
    saveDataBtn.addEventListener('click', updateAndSaveFromDOM);
    cancelDataBtn.addEventListener('click', uiEndEditMode);
    resetDataBtn.addEventListener('click', resetProductData);

    // Tab listeners
    dailyAuditTab.addEventListener('click', () => switchTab('daily'));
    weeklyAuditTab.addEventListener('click', () => switchTab('weekly'));
    productDataTab.addEventListener('click', () => switchTab('data'));

    // Set initial tab state
    switchTab('daily');
}

initialize();
