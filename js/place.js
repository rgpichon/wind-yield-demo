/* Shared place selection for Wind Model map + projection panel. */
(function (global) {
  "use strict";

  // type: country | point | cell | null (Europe)
  var sel = { id: null, type: null, cell: null };
  var listeners = [];

  function get() {
    return {
      id: sel.id,
      type: sel.type,
      cell: sel.cell ? Object.assign({}, sel.cell) : null,
    };
  }

  function set(id, type, source, cell) {
    var nextCell = type === "cell" && cell ? Object.assign({}, cell) : null;
    if (
      sel.id === id &&
      sel.type === type &&
      ((!sel.cell && !nextCell) ||
        (sel.cell &&
          nextCell &&
          sel.cell.flat === nextCell.flat &&
          sel.cell.iy === nextCell.iy &&
          sel.cell.ix === nextCell.ix))
    ) {
      return;
    }
    sel.id = id || null;
    sel.type = type || null;
    sel.cell = nextCell;
    listeners.forEach(function (fn) {
      try {
        fn(get(), source || "unknown");
      } catch (e) {}
    });
  }

  function clear(source) {
    set(null, null, source, null);
  }

  function onChange(fn) {
    listeners.push(fn);
  }

  global.PlaceSelection = {
    get: get,
    set: set,
    clear: clear,
    onChange: onChange,
  };
})(window);
