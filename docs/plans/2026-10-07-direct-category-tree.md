# Direct Category Tree

## Behavior

- Remove the intermediate Categories (N) expander. Main-category rows reveal their direct subcategories.
- Selecting another main category selects its repositories and opens its branch. Clicking the selected main category toggles the branch without clearing its filter.
- The separate leading arrow only toggles expansion. Categories without children have no arrow.
- Child rows use the same selection callback as main rows. Navigating to a child opens its parent.
- Purpose and technology retain independent persisted expansion. Multiple branches may stay open.
- Counts remain visible beside reserved edit/hide/delete controls. Long names are truncated with full-name titles.
- Narrow view uses the same vertical tree within a bounded scroll region. Repository data, classification membership and schema versions are unchanged.

## Verification

- 18 focused tests passed: row/arrow behavior, selected child parent, scheme isolation, action separation, counts, existing drag/drop and settings shortcuts.
- Targeted ESLint passed. Production Vite build passed with existing translation-library eval and mixed-import warnings.
- Synthetic desktop and narrow screenshots: `output/category-sidebar-tree/desktop.png`, `desktop-child.png`, `narrow.png`. No real account or classification write was used for screenshots; narrow page overflow check passed.
- Ungrouped repositories continue to appear under the existing main-category list grouping. No unsupported synthetic sidebar filter was introduced.
- Typecheck passed. The desktop was not running at replacement time; actual `dist` was updated, its index hash matched the verified build, and the original desktop launcher was started. Old build: `D:/GSM-backups/category-tree-20261007-210806/dist-before`. The isolated 5207 server was stopped; the other 5174 service was not touched.
