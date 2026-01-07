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
    
    function deleteColumn(colIndex) {
        // Remove column from all rows in allRows array
        allRows.forEach(function(row) {
            if (row.length > colIndex) {
                row.splice(colIndex, 1);
            }
        });
        
        // Update maxCols
        maxCols = Math.max(...allRows.map(row => row.length), 0);
        
        // Remove column from DOM (skip first column which is delete button)
        const allTableRows = table.querySelectorAll('tr');
        allTableRows.forEach(function(tr) {
            // Get all cells except the first one (delete button)
            const cells = tr.querySelectorAll('td');
            // colIndex + 1 because first cell is delete button
            if (cells.length > colIndex + 1) {
                const cellToRemove = cells[colIndex + 1];
                if (cellToRemove) {
                    cellToRemove.style.transition = 'opacity 0.3s ease';
                    cellToRemove.style.opacity = '0';
                    setTimeout(function() {
                        cellToRemove.remove();
                    }, 300);
                }
            }
        });
        
        // Update clipboard storage
        updateClipboardAfterColumnDelete();
        
        showToast('✅ Kolumna usunięta');
    }
    
    function updateClipboardAfterColumnDelete() {
        // Reconstruct content from allRows (excluding deleted rows)
        const remainingRows = [];
        for (let i = 0; i < allRows.length; i++) {
            if (!deletedRows.has(i)) {
                remainingRows.push(allRows[i].join('\t'));
            }
        }
        
        const updatedContent = remainingRows.join('\n');
        
        // Update storage
        chrome.storage.local.get(['clipboardHashes'], function(result) {
            if (chrome.runtime.lastError) {
                console.error('Error getting clipboardHashes:', chrome.runtime.lastError);
                return;
            }
            
            const clipboardHashes = result.clipboardHashes || [];
            
            chrome.storage.local.set({
                accumulatedClipboard: updatedContent,
                clipboardHashes: clipboardHashes
            }, function() {
                if (chrome.runtime.lastError) {
                    console.error('Error updating storage:', chrome.runtime.lastError);
                    return;
                }
                
                // Update clipboard
                navigator.clipboard.writeText(updatedContent).catch(function(err) {
                    console.error('Failed to update clipboard:', err);
                });
                
                // Update originalContent
                originalContent = updatedContent;
                
                // Notify all tabs to update clipboard info
                notifyAllTabsToUpdateClipboardInfo();
            });
        });
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
    
    // Helper function to check if a row is a header (matches first row)
    function isHeaderRow(rowIndex) {
        if (rowIndex === 0) return true; // First row is always header
        if (allRows.length === 0) return false;
        
        const firstRow = allRows[0];
        const currentRow = allRows[rowIndex];
        
        // Check if current row matches first row (header)
        if (firstRow.length !== currentRow.length) return false;
        
        for (let i = 0; i < firstRow.length; i++) {
            if (firstRow[i] !== currentRow[i]) {
                return false;
            }
        }
        
        return true;
    }
    
    function loadInitialRows() {
        const initialRows = allRows.slice(0, loadedCount);
        
        initialRows.forEach((row, localIndex) => {
            const rowIndex = localIndex; // Actual row index in allRows
            const tr = document.createElement('tr');
            tr.setAttribute('data-row-index', rowIndex);
            
            // Mark header rows (first row or rows matching first row)
            if (isHeaderRow(rowIndex)) {
                tr.className = 'header-row';
            }
            
            // Add delete button as first column (for all rows including headers)
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
                td.setAttribute('data-col-index', i);
                
                // Add delete column button in header rows
                if (isHeaderRow(rowIndex)) {
                    const cellWrapper = document.createElement('div');
                    cellWrapper.style.display = 'flex';
                    cellWrapper.style.alignItems = 'center';
                    cellWrapper.style.justifyContent = 'space-between';
                    cellWrapper.style.gap = '8px';
                    
                    const textSpan = document.createElement('span');
                    textSpan.textContent = cellContent;
                    cellWrapper.appendChild(textSpan);
                    
                    const deleteColBtn = document.createElement('button');
                    deleteColBtn.className = 'delete-col-btn';
                    deleteColBtn.setAttribute('title', 'Usuń kolumnę');
                    deleteColBtn.setAttribute('data-col-index', i);
                    deleteColBtn.textContent = '✕';
                    deleteColBtn.style.cssText = 'background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.3); color: white; cursor: pointer; padding: 2px 6px; border-radius: 3px; font-size: 12px; font-weight: bold; opacity: 0.7; transition: all 0.2s;';
                    deleteColBtn.addEventListener('mouseenter', function() {
                        this.style.opacity = '1';
                        this.style.background = 'rgba(255,255,255,0.3)';
                    });
                    deleteColBtn.addEventListener('mouseleave', function() {
                        this.style.opacity = '0.7';
                        this.style.background = 'rgba(255,255,255,0.2)';
                    });
                    deleteColBtn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        const colIndex = parseInt(this.getAttribute('data-col-index'));
                        deleteColumn(colIndex);
                    });
                    cellWrapper.appendChild(deleteColBtn);
                    
                    td.appendChild(cellWrapper);
                } else {
                    td.textContent = cellContent;
                }
                
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
                
                // Mark header rows (first row or rows matching first row)
                if (isHeaderRow(i)) {
                    tr.className = 'header-row';
                }
                
                // Add delete button as first column (for all rows including headers)
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
                    td.setAttribute('data-col-index', j);
                    
                    // Add delete column button in header rows
                    if (isHeaderRow(i)) {
                        const cellWrapper = document.createElement('div');
                        cellWrapper.style.display = 'flex';
                        cellWrapper.style.alignItems = 'center';
                        cellWrapper.style.justifyContent = 'space-between';
                        cellWrapper.style.gap = '8px';
                        
                        const textSpan = document.createElement('span');
                        textSpan.textContent = cellContent;
                        cellWrapper.appendChild(textSpan);
                        
                        const deleteColBtn = document.createElement('button');
                        deleteColBtn.className = 'delete-col-btn';
                        deleteColBtn.setAttribute('title', 'Usuń kolumnę');
                        deleteColBtn.setAttribute('data-col-index', j);
                        deleteColBtn.textContent = '✕';
                        deleteColBtn.style.cssText = 'background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.3); color: white; cursor: pointer; padding: 2px 6px; border-radius: 3px; font-size: 12px; font-weight: bold; opacity: 0.7; transition: all 0.2s;';
                        deleteColBtn.addEventListener('mouseenter', function() {
                            this.style.opacity = '1';
                            this.style.background = 'rgba(255,255,255,0.3)';
                        });
                        deleteColBtn.addEventListener('mouseleave', function() {
                            this.style.opacity = '0.7';
                            this.style.background = 'rgba(255,255,255,0.2)';
                        });
                        deleteColBtn.addEventListener('click', function(e) {
                            e.stopPropagation();
                            const colIndex = parseInt(this.getAttribute('data-col-index'));
                            deleteColumn(colIndex);
                        });
                        cellWrapper.appendChild(deleteColBtn);
                        
                        td.appendChild(cellWrapper);
                    } else {
                        td.textContent = cellContent;
                    }
                    
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

    // Handle Copy All button
    const copyAllBtn = document.getElementById('copy-all-btn');
    if (copyAllBtn) {
        copyAllBtn.addEventListener('click', function() {
            if (!originalContent || originalContent.trim().length === 0) {
                showToast('⚠️ Brak danych do skopiowania');
                return;
            }

            navigator.clipboard.writeText(originalContent).then(function() {
                showToast('✅ Cała zawartość skopiowana do schowka!');
                
                // Visual confirmation on button
                const oldText = copyAllBtn.textContent;
                copyAllBtn.textContent = '✅ Skopiowano!';
                copyAllBtn.style.backgroundColor = '#1e7e34';
                
                setTimeout(() => {
                    copyAllBtn.textContent = oldText;
                    copyAllBtn.style.backgroundColor = '';
                }, 2000);
            }).catch(function(err) {
                console.error('Błąd kopiowania:', err);
                showToast('❌ Błąd kopiowania do schowka');
            });
        });
    }
})();

