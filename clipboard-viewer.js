(function() {
    let allRows = [];
    let maxCols = 0;
    const batchSize = 50;
    let loadedCount = 0;
    let totalRows = 0;
    let deletedRows = new Set();
    let originalContent = ''; // Store original content to update clipboard
    const table = document.getElementById('data-table');
    const loadingIndicator = document.getElementById('loading-indicator');
    const displayedCountSpan = document.getElementById('displayed-count');
    const recordCountSpan = document.getElementById('record-count');
    const initialLoading = document.getElementById('initial-loading');
    
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    function updateCounts() {
        const visibleRows = totalRows - deletedRows.size;
        if (recordCountSpan) {
            recordCountSpan.textContent = '(' + visibleRows + ' rekordów)';
        }
        if (displayedCountSpan) {
            const visibleDisplayed = Array.from(table.querySelectorAll('tr:not(.deleted)')).length;
            displayedCountSpan.textContent = visibleDisplayed;
        }
    }
    
    function showToast(message) {
        const existingToast = document.getElementById('toast-message');
        if (existingToast) {
            existingToast.remove();
        }
        
        const toast = document.createElement('div');
        toast.id = 'toast-message';
        toast.className = 'toast';
        toast.textContent = message;
        document.body.appendChild(toast);
        
        setTimeout(function() {
            toast.classList.add('show');
        }, 10);
        
        setTimeout(function() {
            toast.classList.remove('show');
            setTimeout(function() {
                toast.remove();
            }, 300);
        }, 2000);
    }
    
    function deleteRow(rowIndex) {
        if (deletedRows.has(rowIndex)) return;
        
        deletedRows.add(rowIndex);
        const rows = table.querySelectorAll('tr[data-row-index="' + rowIndex + '"]');
        rows.forEach(function(row) {
            row.classList.add('deleted');
            row.style.transition = 'opacity 0.3s ease';
            row.style.opacity = '0';
            setTimeout(function() {
                row.style.display = 'none';
            }, 300);
        });
        
        // Remove row from clipboard storage
        removeRowFromClipboard(rowIndex);
        
        updateCounts();
        showToast('✅ Wiersz usunięty');
    }
    
    function removeRowFromClipboard(rowIndex) {
        if (!originalContent || rowIndex < 0 || rowIndex >= allRows.length) return;
        
        // Reconstruct content from remaining (non-deleted) rows
        const remainingRows = [];
        for (let i = 0; i < allRows.length; i++) {
            if (!deletedRows.has(i)) {
                remainingRows.push(allRows[i].join('\t'));
            }
        }
        
        const updatedContent = remainingRows.join('\n');
        
        // Update storage without modifying clipboardHashes
        chrome.storage.local.get(['clipboardHashes'], function(result) {
            if (chrome.runtime.lastError) {
                console.error('Error getting clipboardHashes:', chrome.runtime.lastError);
                return;
            }
            
            const clipboardHashes = result.clipboardHashes || [];
            
            chrome.storage.local.set({
                accumulatedClipboard: updatedContent,
                clipboardHashes: clipboardHashes // Keep hashes unchanged - they represent original tables
            }, function() {
                if (chrome.runtime.lastError) {
                    console.error('Error updating storage:', chrome.runtime.lastError);
                    return;
                }
                
                // Update clipboard
                navigator.clipboard.writeText(updatedContent).catch(function(err) {
                    console.error('Failed to update clipboard:', err);
                });
                
                // Update originalContent for future deletions
                originalContent = updatedContent;
                
                // Notify all tabs to update clipboard info
                notifyAllTabsToUpdateClipboardInfo();
            });
        });
    }
    
    function notifyAllTabsToUpdateClipboardInfo() {
        // Send message to background script to notify all tabs
        chrome.runtime.sendMessage({
            action: 'updateClipboardInfo'
        }, function(response) {
            if (chrome.runtime.lastError) {
                console.error('Error notifying tabs:', chrome.runtime.lastError);
            }
        });
    }
    
    function initializeTable(content) {
        if (!content || content.trim().length === 0) {
            initialLoading.textContent = '⚠️ Schowek jest pusty';
            return;
        }
        
        // Store original content for deletion
        originalContent = content;
        
        // Parse content into table rows
        const lines = content.split('\n').filter(line => line.trim().length > 0);
        
        if (lines.length === 0) {
            initialLoading.textContent = '⚠️ Schowek jest pusty';
            return;
        }
        
        // Split each line by tabs
        const rows = lines.map(line => line.split('\t').map(cell => cell.trim()));
        
        // Find maximum number of columns
        maxCols = Math.max(...rows.map(row => row.length));
        
        // Convert rows to padded format
        allRows = rows.map(row => {
            const paddedRow = [];
            for (let i = 0; i < maxCols; i++) {
                paddedRow.push(row[i] || '');
            }
            return paddedRow;
        });
        
        totalRows = allRows.length;
        loadedCount = Math.min(50, totalRows);
        
        // Hide loading, show table
        initialLoading.style.display = 'none';
        table.style.display = 'table';
        
        // Load initial batch
        loadInitialRows();
        updateCounts();
        
        // Show loading indicator if more rows to load
        if (totalRows > loadedCount) {
            loadingIndicator.style.display = 'block';
        }
    }
    
    function loadInitialRows() {
        const initialRows = allRows.slice(0, loadedCount);
        
        initialRows.forEach((row, rowIndex) => {
            const tr = document.createElement('tr');
            tr.setAttribute('data-row-index', rowIndex);
            
            // Add delete button as first column
            const deleteCell = document.createElement('td');
            deleteCell.className = 'delete-cell';
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-btn';
            deleteBtn.setAttribute('title', 'Usuń wiersz');
            deleteBtn.setAttribute('data-row-index', rowIndex);
            deleteBtn.textContent = '🗑️';
            deleteBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                deleteRow(rowIndex);
            });
            deleteCell.appendChild(deleteBtn);
            tr.appendChild(deleteCell);
            
            for (let i = 0; i < maxCols; i++) {
                const cellContent = escapeHtml(row[i] || '');
                const cellClass = i === 0 ? 'row-number' : '';
                const td = document.createElement('td');
                td.className = cellClass;
                td.textContent = cellContent;
                tr.appendChild(td);
            }
            
            table.appendChild(tr);
        });
    }
    
    function loadMoreRows() {
        if (loadedCount >= totalRows) {
            if (loadingIndicator) {
                loadingIndicator.style.display = 'none';
            }
            return;
        }
        
        if (loadingIndicator) {
            loadingIndicator.classList.add('loading');
        }
        
        // Simulate slight delay for smooth loading
        setTimeout(function() {
            const endIndex = Math.min(loadedCount + batchSize, totalRows);
            
            for (let i = loadedCount; i < endIndex; i++) {
                if (deletedRows.has(i)) continue;
                
                const row = allRows[i];
                const tr = document.createElement('tr');
                tr.setAttribute('data-row-index', i);
                
                // Add delete button as first column
                const deleteCell = document.createElement('td');
                deleteCell.className = 'delete-cell';
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'delete-btn';
                deleteBtn.setAttribute('title', 'Usuń wiersz');
                deleteBtn.setAttribute('data-row-index', i);
                deleteBtn.textContent = '🗑️';
                deleteBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    const rowIndex = parseInt(this.getAttribute('data-row-index'));
                    deleteRow(rowIndex);
                });
                deleteCell.appendChild(deleteBtn);
                tr.appendChild(deleteCell);
                
                for (let j = 0; j < maxCols; j++) {
                    const cellContent = escapeHtml(row[j] || '');
                    const cellClass = j === 0 ? 'row-number' : '';
                    const td = document.createElement('td');
                    td.className = cellClass;
                    td.textContent = cellContent;
                    tr.appendChild(td);
                }
                
                table.appendChild(tr);
            }
            
            loadedCount = endIndex;
            if (displayedCountSpan) {
                displayedCountSpan.textContent = loadedCount;
            }
            
            if (loadingIndicator) {
                loadingIndicator.classList.remove('loading');
                if (loadedCount >= totalRows) {
                    loadingIndicator.style.display = 'none';
                }
            }
        }, 100);
    }
    
    // Load more when scrolling near bottom
    let isLoading = false;
    window.addEventListener('scroll', function() {
        if (isLoading || loadedCount >= totalRows) return;
        
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const windowHeight = window.innerHeight;
        const documentHeight = document.documentElement.scrollHeight;
        
        // Load more when 200px from bottom
        if (scrollTop + windowHeight >= documentHeight - 200) {
            isLoading = true;
            loadMoreRows();
            setTimeout(function() {
                isLoading = false;
            }, 300);
        }
    });
    
    // Initial check in case content is already visible
    setTimeout(function() {
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const windowHeight = window.innerHeight;
        const documentHeight = document.documentElement.scrollHeight;
        
        if (scrollTop + windowHeight >= documentHeight - 200 && loadedCount < totalRows) {
            loadMoreRows();
        }
    }, 100);
    
    // Load data from chrome.storage on page load
    chrome.storage.local.get(['accumulatedClipboard'], function(result) {
        if (chrome.runtime.lastError) {
            initialLoading.textContent = '❌ Błąd podczas ładowania danych: ' + chrome.runtime.lastError.message;
            return;
        }
        
        const content = result.accumulatedClipboard || '';
        initializeTable(content);
    });
})();

