(function () {
  function initProfileMenu() {
    var btn = document.getElementById('profileBtn');
    var menu = document.getElementById('profileMenu');
    if (!btn || !menu) return;

    function close() {
      menu.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = menu.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    menu.addEventListener('click', function (e) {
      e.stopPropagation();
    });

    document.addEventListener('click', function () {
      close();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function fmtDateRange(issued, expires) {
    if (!issued) return '';
    var exp = String(expires || '').trim();
    if (!exp) exp = 'Бессрочно';
    return issued + ' — ' + exp;
  }

  function statusIcon(status) {
    if (status === 'revoked') return '×';
    if (status === 'invalid') return '×';
    if (status === 'pending') return '!';
    if (status === 'valid') return '✓';
    if (status === 'expired') return '!';
    return '?';
  }

  function certTypeLabel(t) {
    return t === 'internal' ? 'Внутренний' : 'Внешний';
  }

  function safeLower(s) {
    return String(s || '').toLowerCase();
  }

  function initCertification() {
    var myInternalList = document.getElementById('myInternalList');
    if (!myInternalList) return; // не страница сертификации
    var myExternalList = document.getElementById('myExternalList');

    // tabs
    var tabBtns = Array.prototype.slice.call(document.querySelectorAll('.tab[data-tab]'));
    var tabPanels = Array.prototype.slice.call(document.querySelectorAll('.tab-panel[data-tabpanel]'));
    var addBtn = document.getElementById('addCertBtn');

    // my
    var myEmpty = document.getElementById('certEmpty');
    var myInternalEmpty = document.getElementById('myInternalEmpty');
    var myExternalEmpty = document.getElementById('myExternalEmpty');
    var myInternalSection = document.getElementById('myInternalSection');
    var myExternalSection = document.getElementById('myExternalSection');
    var myShownCountEl = document.getElementById('myShownCount');
    var myValidCountEl = document.getElementById('myValidCount');
    var myShowInternal = document.getElementById('myShowInternal');
    var myShowExternal = document.getElementById('myShowExternal');
    var myShowValid = document.getElementById('myShowValid');
    var myShowPending = document.getElementById('myShowPending');
    var myShowPassed = document.getElementById('myShowPassed');
    var myShowFailed = document.getElementById('myShowFailed');
    var myShowRevoked = document.getElementById('myShowRevoked');
    var myShowExpired = document.getElementById('myShowExpired');

    var reqList = document.getElementById('reqList');
    var reqEmpty = document.getElementById('reqEmpty');

    // team (таблица)
    var teamTableWrap = document.getElementById('teamTableWrap');
    var teamTableBody = document.getElementById('teamTableBody');
    var teamTableEmpty = document.getElementById('teamTableEmpty');
    var teamEmpty = document.getElementById('teamEmpty');
    var teamSearch = document.getElementById('teamSearch');
    var teamFilter = document.getElementById('teamFilter');
    var teamModuleFilter = document.getElementById('teamModuleFilter');
    var teamGradeFilter = document.getElementById('teamGradeFilter');
    var teamExpiryFilter = document.getElementById('teamExpiryFilter');
    var teamScopeHint = document.getElementById('teamScopeHint');
    var exportTeamCsvBtn = document.getElementById('exportTeamCsvBtn');

    // сортировка таблицы сертификатов сотрудников
    var teamSortKey = 'id';
    var teamSortDir = 'desc';
    var teamTable = document.getElementById('teamTable');
    var teamSortHeaders = teamTable ? Array.prototype.slice.call(teamTable.querySelectorAll('thead th[data-sort]')) : [];


    // modals (add)
    var addModal = document.getElementById('certModal');
    var addForm = document.getElementById('certForm');
    var addErr = document.getElementById('certFormError');
    var topicField = document.getElementById('topicField');
    var examHint = document.getElementById('examHint');

    // бессрочность
    var expiresField = document.getElementById('expiresField');
    var perpetualAdd = document.getElementById('isPerpetualCertAdd');

    // modals (exam)
    var examModal = document.getElementById('examModal');
    var examForm = document.getElementById('examForm');
    var examErr = document.getElementById('examFormError');
    var examTargetHint = document.getElementById('examTargetHint');

    // modals (revoke)
    var revokeModal = document.getElementById('revokeModal');
    var revokeForm = document.getElementById('revokeForm');
    var revokeErr = document.getElementById('revokeFormError');
    var revokeTargetHint = document.getElementById('revokeTargetHint');

    var cachedMe = null;
    var myAll = [];
    var teamAll = [];
    var teamCanRevoke = false;
    var teamScopeText = '';

    setExportEnabled(false);

    function todayISO() {
      var t = new Date();
      var yyyy = t.getFullYear();
      var mm = String(t.getMonth() + 1).padStart(2, '0');
      var dd = String(t.getDate()).padStart(2, '0');
      return yyyy + '-' + mm + '-' + dd;
    }

    function fetchMe() {
      if (cachedMe) return Promise.resolve(cachedMe);
      return fetch('/api/users/me', { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (d) { cachedMe = d; return d; })
        .catch(function () { return null; });
    }

    function openModal(modalEl, errEl, formEl) {
      if (!modalEl) return;
      modalEl.classList.add('open');
      modalEl.setAttribute('aria-hidden', 'false');
      if (errEl) errEl.textContent = '';
      if (formEl) {
        // префилл дат
        var issued = formEl.querySelector('input[name=\"issued_at\"]');
        if (issued && !issued.value) issued.value = todayISO();
        var examDate = formEl.querySelector('input[name=\"exam_date\"]');
        if (examDate && !examDate.value) examDate.value = todayISO();
      }
    }

    function closeModal(modalEl, errEl, formEl) {
      if (!modalEl) return;
      modalEl.classList.remove('open');
      modalEl.setAttribute('aria-hidden', 'true');
      if (formEl) formEl.reset();
      if (errEl) errEl.textContent = '';
    }

    function bindModalClose(modalEl, errEl, formEl) {
      if (!modalEl) return;
      modalEl.addEventListener('click', function (e) {
        var t = e.target;
        if (t && t.getAttribute && t.getAttribute('data-close') === '1') {
          closeModal(modalEl, errEl, formEl);
        }
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeModal(modalEl, errEl, formEl);
      });
    }

    function addBadges(titleRow, cert) {
      titleRow.appendChild(el('span', 'badge', certTypeLabel(cert.cert_type)));
      if (cert.workflow_status === 'revoked') {
        titleRow.appendChild(el('span', 'badge badge--revoked', 'Отозван'));
      } else if (cert.cert_type === 'internal' && cert.workflow_status === 'pending_exam') {
        titleRow.appendChild(el('span', 'badge', 'Экзамен'));
      } else if (cert.cert_type === 'internal' && cert.workflow_status === 'passed') {
        titleRow.appendChild(el('span', 'badge', 'Сдан'));
      } else if (cert.cert_type === 'internal' && cert.workflow_status === 'failed') {
        titleRow.appendChild(el('span', 'badge badge--failed', 'Не сдан'));
      }
    }

    function buildStatusText(cert) {
      if (cert.workflow_status === 'revoked') {
        var who = cert.revoked_by_name ? ('HR: ' + cert.revoked_by_name) : 'HR: —';
        var reason = cert.revoked_reason ? ('Причина: ' + cert.revoked_reason) : 'Причина: —';
        return 'Сертификат отозван. ' + who + '. ' + reason;
      }
      if (cert.cert_type === 'internal' && cert.workflow_status === 'pending_exam') {
        var who2 = cert.required_examiner_name ? ('у ' + cert.required_examiner_name) : '— не назначен экзаменатор';
        return 'Необходимо сдать экзамен ' + who2;
      }
      if (cert.cert_type === 'internal' && cert.workflow_status === 'passed') {
        var info = 'Экзамен: ' + (cert.exam_grade || '—');
        if (cert.exam_date) info += ' (' + cert.exam_date + ')';
        return info;
      }
      if (cert.cert_type === 'internal' && cert.workflow_status === 'failed') {
        var info2 = 'Экзамен: не сдан';
        if (cert.exam_date) info2 += ' (' + cert.exam_date + ')';
        return info2;
      }
      return cert.status_label || '';
    }

    // --- Группировка внутри секций по статусам ---
    var GROUP_ORDER = ['pending_exam', 'failed', 'passed', 'revoked', 'expired', 'valid'];

    function groupLabelAndKey(cert) {
      // 1) HR-отзыв
      if (cert.workflow_status === 'revoked') return { key: 'revoked', label: 'Отозваны' };

      // 2) Просрочка по сроку действия
      if (cert.status === 'expired') return { key: 'expired', label: 'Просрочены' };

      // 3) Внутренние сертификаты: экзамен
      if (cert.cert_type === 'internal') {
        if (cert.workflow_status === 'pending_exam') return { key: 'pending_exam', label: 'Ожидают экзамен' };
        if (cert.workflow_status === 'failed') return { key: 'failed', label: 'Экзамен не сдан' };
        if (cert.workflow_status === 'passed') return { key: 'passed', label: 'Экзамен сдан' };
      }

      // 4) Всё остальное считаем действующим
      return { key: 'valid', label: 'Действительны' };
    }

    function appendCards(listEl, items, opts) {
      if (!listEl) return;
      (items || []).forEach(function (c) {
        var cardCls = 'cert-card';
        if (opts && opts.variant) cardCls += ' ' + opts.variant;
        if (opts && opts.preview) cardCls += ' cert-card--preview';
        if (c.workflow_status === 'revoked') cardCls += ' cert-card--revoked';

        var card = el('div', cardCls + ' cert-card--clickable');
        card.dataset.certId = String(c.id);
        var body = el('div', 'cert-card-body');

        // Для превью-карточек ("Мои сертификаты") делаем компактную двухколоночную верстку:
        // слева картинка, справа контент и кнопки. Так влезает больше карточек на экран.
        var contentWrap = body;
        if (opts && opts.preview) {
          body.classList.add('cert-card-body--preview');
          contentWrap = el('div', 'cert-card-content');

          var prev = el('div', 'cert-preview');
          var previewLink = el('a', 'cert-preview-link');
          previewLink.href = '/certificate/' + encodeURIComponent(c.id);
          previewLink.setAttribute('title', 'Открыть карточку сертификата');

          var imgPrev = el('img', 'cert-preview-img');
          imgPrev.alt = 'Превью сертификата';
          imgPrev.loading = 'lazy';
          imgPrev.src = '/api/certificates/' + encodeURIComponent(c.id) + '/image';

          previewLink.appendChild(imgPrev);
          prev.appendChild(previewLink);

          body.appendChild(prev);
          body.appendChild(contentWrap);
        }

        var titleRow = el('div', 'cert-title-row');
        var titleLink = el('a', 'cert-title-link', c.name || 'Сертификат');
        titleLink.href = '/certificate/' + encodeURIComponent(c.id);
        titleLink.setAttribute('title', 'Открыть карточку сертификата');
        titleRow.appendChild(titleLink);
        addBadges(titleRow, c);
        contentWrap.appendChild(titleRow);

        if (opts && opts.showEmployee) {
          var emp = c.snapshot_full_name || ('Сотрудник #' + c.owner_id);
          var pos = c.snapshot_position ? (' — ' + c.snapshot_position) : '';
          contentWrap.appendChild(el('div', 'cert-meta', emp + pos));
          if (c.snapshot_module) contentWrap.appendChild(el('div', 'cert-meta', 'Модуль: ' + c.snapshot_module));
        }

        if (c.cert_type === 'internal' && c.topic) {
          contentWrap.appendChild(el('div', 'cert-meta', 'Профиль: ' + c.topic));
        }

        contentWrap.appendChild(el('div', 'cert-dates', fmtDateRange(c.issued_at, c.expires_at)));
        contentWrap.appendChild(el('div', 'cert-status-text', buildStatusText(c)));

        // actions
        var actions = null;
        var qrWrap = null;

        // Скачать + Поделиться (QR) — только в "Мои сертификаты" (превью)
        if (opts && opts.preview) {
          actions = actions || el('div', 'cert-actions');

          var aDl = el('a', 'btn btn--sm btn--primary', 'Скачать PDF');
          aDl.href = '/api/certificates/' + encodeURIComponent(c.id) + '/pdf';
          aDl.setAttribute('title', 'Скачать PDF');
          actions.appendChild(aDl);

          var btnShare = el('button', 'btn btn--sm btn--outline', 'Поделиться');
          btnShare.type = 'button';
          actions.appendChild(btnShare);

          var shareUrl = (window.location && window.location.origin ? window.location.origin : '') + '/certificate/' + encodeURIComponent(c.id);

          qrWrap = el('div', 'qr-wrap');
          var qrImg = el('img', 'qr-img');
          qrImg.alt = 'QR код';
          qrImg.loading = 'lazy';
          qrImg.dataset.src = '/api/certificates/' + encodeURIComponent(c.id) + '/qr';
          qrWrap.appendChild(qrImg);

          var qrMeta = el('div', 'qr-meta');
          qrMeta.appendChild(el('div', null, 'Отсканируйте QR или откройте ссылку:'));

          var link = el('a', 'qr-link', shareUrl);
          link.href = shareUrl;
          link.target = '_blank';
          link.rel = 'noopener';
          qrMeta.appendChild(link);

          var btnCopy = el('button', 'btn btn--sm btn--outline', 'Копировать ссылку');
          btnCopy.type = 'button';
          btnCopy.addEventListener('click', function () {
            try {
              if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(shareUrl);
              }
            } catch (e) {}
          });
          qrMeta.appendChild(btnCopy);

          qrWrap.appendChild(qrMeta);

          btnShare.addEventListener('click', function () {
            var open = qrWrap.classList.toggle('open');
            if (open && !qrImg.src) {
              qrImg.src = qrImg.dataset.src + '?t=' + Date.now();
            }
          });
        }

        if (opts && opts.canExam && c.cert_type === 'internal' && c.workflow_status === 'pending_exam' && opts.me && String(c.required_examiner_id || '') === String(opts.me.id)) {
          actions = actions || el('div', 'cert-actions');
          var btnExam = el('button', 'btn btn--sm btn--primary', 'Оценить');
          btnExam.type = 'button';
          btnExam.addEventListener('click', function () {
            if (!examForm || !examModal) return;
            examForm.querySelector('input[name=\"cert_id\"]').value = String(c.id);
            if (examTargetHint) {
              var emp2 = c.snapshot_full_name || ('Сотрудник #' + c.owner_id);
              examTargetHint.textContent = 'Сотрудник: ' + emp2 + (c.topic ? (' • Профиль: ' + c.topic) : '');
            }
            openModal(examModal, examErr, examForm);
          });
          actions.appendChild(btnExam);
        }

        if (opts && opts.canRevoke && c.workflow_status !== 'revoked') {
          actions = actions || el('div', 'cert-actions');
          var btnRev = el('button', 'btn btn--sm btn--danger', 'Отозвать');
          btnRev.type = 'button';
          btnRev.addEventListener('click', function () {
            if (!revokeForm || !revokeModal) return;
            revokeForm.querySelector('input[name=\"cert_id\"]').value = String(c.id);
            if (revokeTargetHint) {
              var emp3 = c.snapshot_full_name || ('Сотрудник #' + c.owner_id);
              revokeTargetHint.textContent = emp3 + ' • ' + (c.name || 'Сертификат');
            }
            openModal(revokeModal, revokeErr, revokeForm);
          });
          actions.appendChild(btnRev);
        }

        if (actions) contentWrap.appendChild(actions);
        if (qrWrap) contentWrap.appendChild(qrWrap);

        var st = el('div', 'cert-status cert-status--' + (c.status || 'unknown'), statusIcon(c.status));
        card.appendChild(body);
        card.appendChild(st);
        listEl.appendChild(card);
      });
    }

    function renderCards(listEl, emptyEl, items, opts) {
      if (!listEl) return;
      listEl.innerHTML = '';

      if (!items || items.length === 0) {
        if (emptyEl) {
          emptyEl.style.display = 'block';
          emptyEl.textContent = (opts && opts.emptyText) ? opts.emptyText : 'Нет данных.';
        }
        return;
      }
      if (emptyEl) emptyEl.style.display = 'none';
      appendCards(listEl, items, opts);
    }

    function renderGrouped(listEl, emptyEl, items, opts) {
      if (!listEl) return;
      listEl.innerHTML = '';

      if (!items || items.length === 0) {
        if (emptyEl) {
          emptyEl.style.display = 'block';
          emptyEl.textContent = (opts && opts.emptyText) ? opts.emptyText : 'Нет данных.';
        }
        return;
      }
      if (emptyEl) emptyEl.style.display = 'none';

      var buckets = {};
      (items || []).forEach(function (c) {
        var g = groupLabelAndKey(c);
        if (!buckets[g.key]) buckets[g.key] = { label: g.label, items: [] };
        buckets[g.key].items.push(c);
      });

      GROUP_ORDER.forEach(function (key) {
        var b = buckets[key];
        if (!b || !b.items || !b.items.length) return;
        var title = el('div', 'cert-group-title', b.label + ' (' + b.items.length + ')');
        listEl.appendChild(title);
        appendCards(listEl, b.items, opts);
      });
    }

    function clearList(listEl) {
      if (listEl) listEl.innerHTML = '';
    }

    function readMyFilters() {
      function safeChecked(el, def) { return el ? !!el.checked : def; }
      var defAll = {
        showInternal: true,
        showExternal: true,
        showValid: true,
        showPending: true,
        showPassed: true,
        showFailed: true,
        showRevoked: true,
        showExpired: true
      };
      try {
        var raw = localStorage.getItem('my_cert_filters_v1');
        if (!raw) return defAll;
        var parsed = JSON.parse(raw);
        return {
          showInternal: parsed.showInternal !== undefined ? !!parsed.showInternal : defAll.showInternal,
          showExternal: parsed.showExternal !== undefined ? !!parsed.showExternal : defAll.showExternal,
          showValid: parsed.showValid !== undefined ? !!parsed.showValid : defAll.showValid,
          showPending: parsed.showPending !== undefined ? !!parsed.showPending : defAll.showPending,
          showPassed: parsed.showPassed !== undefined ? !!parsed.showPassed : defAll.showPassed,
          showFailed: parsed.showFailed !== undefined ? !!parsed.showFailed : defAll.showFailed,
          showRevoked: parsed.showRevoked !== undefined ? !!parsed.showRevoked : defAll.showRevoked,
          showExpired: parsed.showExpired !== undefined ? !!parsed.showExpired : defAll.showExpired
        };
      } catch (e) {
        return {
          showInternal: safeChecked(myShowInternal, true),
          showExternal: safeChecked(myShowExternal, true),
          showValid: safeChecked(myShowValid, true),
          showPending: safeChecked(myShowPending, true),
          showPassed: safeChecked(myShowPassed, true),
          showFailed: safeChecked(myShowFailed, true),
          showRevoked: safeChecked(myShowRevoked, true),
          showExpired: safeChecked(myShowExpired, true)
        };
      }
    }

    function applyMyFilters(all) {
      var f = readMyFilters();
      return (all || []).filter(function (c) {
        // type
        if (c.cert_type === 'internal') {
          if (!f.showInternal) return false;
        } else {
          if (!f.showExternal) return false;
        }
        // status-group
        var g = groupLabelAndKey(c).key;
        if (g === 'valid' && !f.showValid) return false;
        if (g === 'pending_exam' && !f.showPending) return false;
        if (g === 'passed' && !f.showPassed) return false;
        if (g === 'failed' && !f.showFailed) return false;
        if (g === 'revoked' && !f.showRevoked) return false;
        if (g === 'expired' && !f.showExpired) return false;
        return true;
      });
    }

    function isTrulyValid(cert) {
      if (!cert) return false;
      if (cert.workflow_status === 'revoked') return false;
      if (cert.status === 'expired') return false;
      if (cert.cert_type === 'internal') return cert.workflow_status === 'passed';
      return true;
    }

    function syncMyFilterUIFromStorage() {
      var f = readMyFilters();
      if (myShowInternal) myShowInternal.checked = !!f.showInternal;
      if (myShowExternal) myShowExternal.checked = !!f.showExternal;
      if (myShowValid) myShowValid.checked = !!f.showValid;
      if (myShowPending) myShowPending.checked = !!f.showPending;
      if (myShowPassed) myShowPassed.checked = !!f.showPassed;
      if (myShowFailed) myShowFailed.checked = !!f.showFailed;
      if (myShowRevoked) myShowRevoked.checked = !!f.showRevoked;
      if (myShowExpired) myShowExpired.checked = !!f.showExpired;
    }

    function saveMyFilters() {
      var f = {
        showInternal: myShowInternal ? !!myShowInternal.checked : true,
        showExternal: myShowExternal ? !!myShowExternal.checked : true,
        showValid: myShowValid ? !!myShowValid.checked : true,
        showPending: myShowPending ? !!myShowPending.checked : true,
        showPassed: myShowPassed ? !!myShowPassed.checked : true,
        showFailed: myShowFailed ? !!myShowFailed.checked : true,
        showRevoked: myShowRevoked ? !!myShowRevoked.checked : true,
        showExpired: myShowExpired ? !!myShowExpired.checked : true
      };
      try { localStorage.setItem('my_cert_filters_v1', JSON.stringify(f)); } catch (e) {}
    }

    function renderMy(items) {
      var all = items || [];

      // когда сертификатов нет совсем
      if (!all.length) {
        if (myEmpty) {
          myEmpty.style.display = 'block';
          myEmpty.textContent = 'Пока нет сертификатов. Нажмите “+ Добавить сертификат”, чтобы добавить.';
        }
        if (myInternalSection) myInternalSection.style.display = 'none';
        if (myExternalSection) myExternalSection.style.display = 'none';
        if (myInternalEmpty) myInternalEmpty.style.display = 'none';
        if (myExternalEmpty) myExternalEmpty.style.display = 'none';
        clearList(myInternalList);
        clearList(myExternalList);
        if (myShownCountEl) myShownCountEl.textContent = '0';
        if (myValidCountEl) myValidCountEl.textContent = '0';
        return;
      }

      // фильтры
      var filtered = applyMyFilters(all);
      var shown = filtered.length;
      var valid = filtered.filter(isTrulyValid).length;
      if (myShownCountEl) myShownCountEl.textContent = String(shown);
      if (myValidCountEl) myValidCountEl.textContent = String(valid);

      // если фильтры скрыли всё
      if (!filtered.length) {
        if (myInternalSection) myInternalSection.style.display = 'none';
        if (myExternalSection) myExternalSection.style.display = 'none';
        if (myEmpty) {
          myEmpty.style.display = 'block';
          myEmpty.textContent = 'Нет сертификатов по выбранным фильтрам.';
        }
        if (myInternalEmpty) myInternalEmpty.style.display = 'none';
        if (myExternalEmpty) myExternalEmpty.style.display = 'none';
        clearList(myInternalList);
        clearList(myExternalList);
        return;
      }

      if (myEmpty) myEmpty.style.display = 'none';

      var showInternal = myShowInternal ? !!myShowInternal.checked : true;
      var showExternal = myShowExternal ? !!myShowExternal.checked : true;

      // разделение по типам
      var internal = filtered.filter(function (c) { return c.cert_type === 'internal'; });
      var external = filtered.filter(function (c) { return c.cert_type !== 'internal'; });

      // секции (тип)
      if (myInternalSection) myInternalSection.style.display = showInternal ? 'block' : 'none';
      if (myExternalSection) myExternalSection.style.display = showExternal ? 'block' : 'none';

      if (showInternal) {
        renderGrouped(myInternalList, myInternalEmpty, internal, { emptyText: 'Нет внутренних сертификатов по выбранным фильтрам.', preview: true });
      } else {
        if (myInternalEmpty) myInternalEmpty.style.display = 'none';
        clearList(myInternalList);
      }

      if (showExternal) {
        renderGrouped(myExternalList, myExternalEmpty, external, { emptyText: 'Нет внешних сертификатов по выбранным фильтрам.', preview: true });
      } else {
        if (myExternalEmpty) myExternalEmpty.style.display = 'none';
        clearList(myExternalList);
      }
    }

    function renderRequests(items) {
      if (!reqList) return;
      renderCards(reqList, reqEmpty, items, { emptyText: 'Нет запросов на экзамен.', variant: 'cert-card--request', showEmployee: true, canExam: true, me: cachedMe });
    }

    function setSelectOptions(selectEl, values, allLabel) {
      if (!selectEl) return;
      var selected = selectEl.value || 'all';
      selectEl.innerHTML = '';
      var optAll = document.createElement('option');
      optAll.value = 'all';
      optAll.textContent = allLabel || 'Все';
      selectEl.appendChild(optAll);
      (values || []).forEach(function (v) {
        var o = document.createElement('option');
        o.value = v;
        o.textContent = v;
        selectEl.appendChild(o);
      });
      // restore selection if possible
      var has = Array.prototype.some.call(selectEl.options, function (o) { return o.value === selected; });
      selectEl.value = has ? selected : 'all';
    }

    function buildTeamFilterOptions() {
      var mods = {};
      var grades = {};
      (teamAll || []).forEach(function (c) {
        var m = c.snapshot_module || 'Модуль Сертификации';
        if (m) mods[m] = true;
        var g = c.snapshot_position || '';
        if (g) grades[g] = true;
      });
      var modList = Object.keys(mods).sort();
      var gradeList = Object.keys(grades).sort();
      setSelectOptions(teamModuleFilter, modList, 'Все модули');
      setSelectOptions(teamGradeFilter, gradeList, 'Все грейды');
    }

    function setSelectOptions(selectEl, values, allLabel) {
      if (!selectEl) return;
      var current = selectEl.value || 'all';
      var opts = ['all'];
      var labels = {'all': allLabel || 'Все'};
      (values || []).forEach(function (v) {
        if (!v) return;
        if (opts.indexOf(v) === -1) opts.push(v);
      });
      selectEl.innerHTML = '';
      opts.forEach(function (v) {
        var o = document.createElement('option');
        o.value = v;
        o.textContent = labels[v] || v;
        selectEl.appendChild(o);
      });
      if (opts.indexOf(current) === -1) current = 'all';
      selectEl.value = current;
    }

    function buildTeamFilterOptions() {
      if (!teamModuleFilter && !teamGradeFilter) return;
      var mods = {};
      var grades = {};
      (teamAll || []).forEach(function (c) {
        var mod = c.snapshot_module || 'Модуль Сертификации';
        if (mod) mods[mod] = true;
        var gr = c.snapshot_position || '';
        if (gr) grades[gr] = true;
      });
      var modList = Object.keys(mods).sort();
      var gradeList = Object.keys(grades).sort();
      setSelectOptions(teamModuleFilter, modList, 'Все модули');
      setSelectOptions(teamGradeFilter, gradeList, 'Все грейды');
    }

    function applyTeamFilters(items) {
      var q = safeLower(teamSearch && teamSearch.value);
      var f = (teamFilter && teamFilter.value) || 'all';
      var m = (teamModuleFilter && teamModuleFilter.value) || 'all';
      var g = (teamGradeFilter && teamGradeFilter.value) || 'all';
      var e = (teamExpiryFilter && teamExpiryFilter.value) || 'all';

      return (items || []).filter(function (c) {
        // status filter
        if (f === 'pending_exam' && c.workflow_status !== 'pending_exam') return false;
        if (f === 'passed' && c.workflow_status !== 'passed') return false;
        if (f === 'failed' && c.workflow_status !== 'failed') return false;
        if (f === 'revoked' && c.workflow_status !== 'revoked') return false;
        if (f === 'valid' && c.status !== 'valid') return false;
        if (f === 'expired' && c.status !== 'expired') return false;

        // module filter
        if (m !== 'all') {
          var cm = c.snapshot_module || 'Модуль Сертификации';
          if (cm !== m) return false;
        }

        // grade filter
        if (g !== 'all') {
          var cg = c.snapshot_position || '';
          if (cg !== g) return false;
        }


        // expiry filter
        if (e === 'perpetual') {
          var ex = String(c.expires_at || '').trim();
          if (ex) return false;
        } else if (e === 'with_expiry') {
          var ex2 = String(c.expires_at || '').trim();
          if (!ex2) return false;
        } else if (e === 'expiring_soon') {
          var ex3 = String(c.expires_at || '').trim();
          if (!ex3) return false;
          var ts = parseExpiry(ex3);
          var now = Date.now();
          var horizon = now + 30 * 24 * 60 * 60 * 1000;
          if (ts < now || ts > horizon) return false;
          if (c.status === 'expired') return false;
        }

        if (!q) return true;
        var hay = safeLower(c.name) + ' ' + safeLower(c.topic) + ' ' + safeLower(c.snapshot_full_name) + ' ' + safeLower(c.snapshot_position) + ' ' + safeLower(c.snapshot_manager_name) + ' ' + safeLower(c.snapshot_module);
        return hay.indexOf(q) !== -1;
      });
    }

    function parseISO(d) {
      if (!d) return 0;
      var t = Date.parse(String(d));
      return isNaN(t) ? 0 : t;
    }

    function parseExpiry(d) {
      var s = String(d || '').trim();
      if (!s) return Date.UTC(9999, 11, 31);
      var t = parseISO(s);
      return t || 0;
    }

    function csvEscape(v) {
      var s = (v === undefined || v === null) ? '' : String(v);
      s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      if (s.indexOf('"') !== -1) s = s.replace(/"/g, '""');
      // для ru-локали используем разделитель ";"
      if (/[";\n]/.test(s)) s = '"' + s + '"';
      return s;
    }

    function nowStamp() {
      var d = new Date();
      var yyyy = d.getFullYear();
      var mm = String(d.getMonth() + 1).padStart(2, '0');
      var dd = String(d.getDate()).padStart(2, '0');
      var hh = String(d.getHours()).padStart(2, '0');
      var mi = String(d.getMinutes()).padStart(2, '0');
      return yyyy + mm + dd + '_' + hh + mi;
    }

    function exportTeamCSV() {
      var rows = sortTeamItems(applyTeamFilters(teamAll));
      if (!rows || rows.length === 0) return;

      var delim = ';';
      var header = ['№', 'Тип', 'Сотрудник', 'Руководитель', 'Грейд', 'Модуль', 'Сертификат', 'Профиль', 'Дата выдачи', 'Действителен до', 'Статус', 'Оценка'];
      var lines = [];
      lines.push(header.map(csvEscape).join(delim));

      rows.forEach(function (c) {
        var expRaw = String(c.expires_at || '').trim();
        var expLabel = expRaw ? expRaw : 'Бессрочно';
        var st = teamStatusBadge(c).text;
        var grade = teamGradeText(c);
        var topic = (c.cert_type === 'internal') ? (c.topic || '') : '';
        var row = [
          c.id,
          certTypeLabel(c.cert_type),
          (c.snapshot_full_name || ''),
          (c.snapshot_manager_name || ''),
          (c.snapshot_position || ''),
          (c.snapshot_module || 'Модуль Сертификации'),
          (c.name || ''),
          topic,
          (c.issued_at || ''),
          expLabel,
          st,
          grade
        ];
        lines.push(row.map(csvEscape).join(delim));
      });

      // BOM для корректного открытия в Excel
      var csv = '\ufeff' + lines.join('\r\n');
      var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'сертификаты_сотрудников_' + nowStamp() + '.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 1000);
    }

    function normStatusKey(c) {
      if (c.workflow_status === 'revoked') return 'revoked';
      if (c.status === 'expired') return 'expired';
      if (c.cert_type === 'internal') {
        if (c.workflow_status === 'pending_exam') return 'pending_exam';
        if (c.workflow_status === 'failed') return 'failed';
        if (c.workflow_status === 'passed') return 'passed';
      }
      if (c.status === 'valid') return 'valid';
      return (c.status || 'unknown');
    }

    function statusRank(c) {
      // по умолчанию сортируем так, чтобы проблемы было проще найти
      var k = normStatusKey(c);
      var map = { pending_exam: 1, failed: 2, revoked: 3, expired: 4, passed: 5, valid: 6, unknown: 7 };
      return map[k] !== undefined ? map[k] : 8;
    }

    function cmp(a, b) {
      if (teamSortKey === 'id') {
        return (Number(a.id) || 0) - (Number(b.id) || 0);
      }
      if (teamSortKey === 'dates') {
        // сначала по сроку действия, затем по дате выдачи
        var ae = parseExpiry(a.expires_at);
        var be = parseExpiry(b.expires_at);
        if (ae !== be) return ae - be;
        var ai = parseISO(a.issued_at);
        var bi = parseISO(b.issued_at);
        return ai - bi;
      }
      if (teamSortKey === 'status') {
        var ar = statusRank(a);
        var br = statusRank(b);
        if (ar !== br) return ar - br;
        return (Number(a.id) || 0) - (Number(b.id) || 0);
      }
      return 0;
    }

    function sortTeamItems(items) {
      var arr = (items || []).slice();
      arr.sort(function (a, b) {
        var r = cmp(a, b);
        return teamSortDir === 'asc' ? r : -r;
      });
      return arr;
    }

    function setExportEnabled(enabled) {
      if (!exportTeamCsvBtn) return;
      exportTeamCsvBtn.disabled = !enabled;
    }

    function csvEscape(value) {
      var s = String(value === undefined || value === null ? '' : value);
      s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      if (s.indexOf('"') >= 0) s = s.replace(/"/g, '""');
      // разделитель CSV — ';' (удобно для Excel в RU)
      if (/[";\n]/.test(s)) s = '"' + s + '"';
      return s;
    }

    function nowStamp() {
      var d = new Date();
      var yyyy = d.getFullYear();
      var mm = String(d.getMonth() + 1).padStart(2, '0');
      var dd = String(d.getDate()).padStart(2, '0');
      var hh = String(d.getHours()).padStart(2, '0');
      var mi = String(d.getMinutes()).padStart(2, '0');
      return yyyy + mm + dd + '_' + hh + mi;
    }

    function exportTeamCSV() {
      var rows = sortTeamItems(applyTeamFilters(teamAll));
      if (!rows || rows.length === 0) return;

      var delim = ';';
      var header = ['№', 'Тип', 'Сотрудник', 'Руководитель', 'Грейд', 'Модуль', 'Сертификат', 'Профиль', 'Дата выдачи', 'Действителен до', 'Статус', 'Оценка'];
      var lines = [header.map(csvEscape).join(delim)];

      rows.forEach(function (c) {
        var expRaw = String(c.expires_at || '').trim();
        var expLabel = expRaw ? expRaw : 'Бессрочно';
        var st = teamStatusBadge(c).text;
        var grade = teamGradeText(c);
        var topic = (c.cert_type === 'internal') ? (c.topic || '') : '';
        var manager = c.snapshot_manager_name || '';
        var vals = [
          c.id,
          certTypeLabel(c.cert_type),
          c.snapshot_full_name || '',
          manager,
          c.snapshot_position || '',
          c.snapshot_module || 'Модуль Сертификации',
          c.name || '',
          topic,
          c.issued_at || '',
          expLabel,
          st,
          grade
        ];
        lines.push(vals.map(csvEscape).join(delim));
      });

      // BOM для корректного открытия в Excel
      var csv = '\ufeff' + lines.join('\r\n');
      var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'сертификаты_сотрудников_' + nowStamp() + '.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 1000);
    }

    function updateTeamSortIndicators() {
      (teamSortHeaders || []).forEach(function (th) {
        var key = th.getAttribute('data-sort');
        var active = key === teamSortKey;
        th.classList.toggle('is-sorted', active);
        th.classList.toggle('is-asc', active && teamSortDir === 'asc');
        th.classList.toggle('is-desc', active && teamSortDir === 'desc');
      });
    }

    function bindTeamSorting() {
      if (!teamSortHeaders || !teamSortHeaders.length) return;
      teamSortHeaders.forEach(function (th) {
        th.addEventListener('click', function () {
          var key = th.getAttribute('data-sort');
          if (!key) return;
          if (teamSortKey === key) {
            teamSortDir = teamSortDir === 'asc' ? 'desc' : 'asc';
          } else {
            teamSortKey = key;
            // для номера по умолчанию показываем новые сверху
            teamSortDir = (key === 'id') ? 'desc' : 'asc';
          }
          updateTeamSortIndicators();
          renderTeam();
        });
      });
      updateTeamSortIndicators();
    }



    function teamStatusBadge(cert) {
      if (cert.workflow_status === 'revoked') {
        return { text: 'Отозван', cls: 'badge--status-revoked' };
      }
      if (cert.status === 'expired') {
        return { text: 'Просрочен', cls: 'badge--status-expired' };
      }
      if (cert.cert_type === 'internal' && cert.workflow_status === 'pending_exam') {
        return { text: 'Ожидает экзамен', cls: 'badge--status-pending' };
      }
      if (cert.cert_type === 'internal' && cert.workflow_status === 'passed') {
        return { text: 'Экзамен сдан', cls: 'badge--status-passed' };
      }
      if (cert.cert_type === 'internal' && cert.workflow_status === 'failed') {
        return { text: 'Экзамен не сдан', cls: 'badge--status-failed' };
      }
      if (cert.status === 'valid') {
        return { text: 'Действителен', cls: 'badge--status-valid' };
      }
      return { text: cert.status_label || '—', cls: 'badge--status-default' };
    }

    function teamGradeText(cert) {
      if (cert.cert_type !== 'internal') return '—';
      if (cert.workflow_status === 'passed') {
        var t = cert.exam_grade || '—';
        if (cert.exam_date) t += ' (' + cert.exam_date + ')';
        return t;
      }
      if (cert.workflow_status === 'failed') {
        var t2 = 'Не сдан';
        if (cert.exam_date) t2 += ' (' + cert.exam_date + ')';
        return t2;
      }
      return '—';
    }

    function isCurrentExaminer(cert) {
      if (!cachedMe) return false;
      return cert.cert_type === 'internal' && String(cert.required_examiner_id || '') === String(cachedMe.id);
    }

    function postQuickExam(certId, grade, btnEl) {
      if (!certId) return;
      if (btnEl) {
        btnEl.disabled = true;
        btnEl.classList.add('is-loading');
      }
      fetch('/api/certificates/' + encodeURIComponent(certId) + '/exam', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ exam_grade: grade, exam_date: todayISO() })
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
        .then(function (res) {
          if (!res.ok) {
            var msg = (res.data && (res.data.detail || res.data.message)) || 'Ошибка';
            throw new Error(msg);
          }
          loadAll();
        })
        .catch(function () {
          // молча — это прототип
          loadAll();
        });
    }

    function postRevoke(certId, reason, btnEl) {
      if (!certId || !reason) return;
      if (btnEl) {
        btnEl.disabled = true;
        btnEl.classList.add('is-loading');
      }
      fetch('/api/certificates/' + encodeURIComponent(certId) + '/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ reason: reason })
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
        .then(function (res) {
          if (!res.ok) {
            var msg = (res.data && (res.data.detail || res.data.message)) || 'Ошибка';
            throw new Error(msg);
          }
          loadAll();
        })
        .catch(function () {
          loadAll();
        });
    }

    function postUnrevoke(certId, btnEl) {
      if (!certId) return;
      if (btnEl) {
        btnEl.disabled = true;
        btnEl.classList.add('is-loading');
      }
      fetch('/api/certificates/' + encodeURIComponent(certId) + '/unrevoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: '{}'
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
        .then(function (res) {
          if (!res.ok) {
            var msg = (res.data && (res.data.detail || res.data.message)) || 'Ошибка';
            throw new Error(msg);
          }
          loadAll();
        })
        .catch(function () {
          loadAll();
        });
    }


    function renderTeam() {
      if (!teamTableBody) return;

      var filtered = sortTeamItems(applyTeamFilters(teamAll));

      // экспорт доступен только если есть строки в текущем представлении
      setExportEnabled(!!(filtered && filtered.length));

      if (teamScopeHint) {
        var msg = teamScopeText || '';
        if (teamCanRevoke) msg += (msg ? ' • ' : '') + 'Вы можете отзывать сертификаты.';
        teamScopeHint.textContent = msg;
        teamScopeHint.style.display = msg ? 'block' : 'none';
      }

      // если не было ошибки загрузки — скрываем сообщение
      if (teamEmpty && (!teamEmpty.textContent || teamEmpty.textContent.indexOf('Не удалось') === -1)) {
        teamEmpty.style.display = 'none';
      }

      if (teamTableBody) teamTableBody.innerHTML = '';

      var emptyText = teamCanRevoke ? 'Нет сертификатов в модуле.' : 'Нет сертификатов сотрудников.';
      if (!filtered || filtered.length === 0) {
        if (teamTableWrap) teamTableWrap.style.display = 'none';
        if (teamTableEmpty) {
          teamTableEmpty.textContent = emptyText;
          teamTableEmpty.style.display = 'block';
        }
        return;
      }

      if (teamTableEmpty) teamTableEmpty.style.display = 'none';
      if (teamTableWrap) teamTableWrap.style.display = 'block';

      filtered.forEach(function (c) {
        var tr = document.createElement('tr');

        // №
        var tdId = el('td', 'cell-id');
        var idLink = el('a', 'table-link', String(c.id));
        idLink.href = '/certificate/' + encodeURIComponent(c.id);
        idLink.target = '_blank';
        idLink.rel = 'noopener';
        tdId.appendChild(idLink);
        tr.appendChild(tdId);

        // Тип
        var tdType = el('td');
        var bType = el('span', 'badge badge--type', certTypeLabel(c.cert_type));
        if (c.cert_type === 'internal') bType.classList.add('badge--type-internal');
        else bType.classList.add('badge--type-external');
        tdType.appendChild(bType);
        tr.appendChild(tdType);

        // Сотрудник
        var tdEmp = el('td', 'cell-emp');
        tdEmp.appendChild(el('div', 'cell-main', c.snapshot_full_name || ('Сотрудник #' + c.owner_id)));
        var mgr = c.snapshot_manager_name ? ('Рук.: ' + c.snapshot_manager_name) : '';
        if (mgr) tdEmp.appendChild(el('div', 'cell-sub', mgr));
        tr.appendChild(tdEmp);

        // Грейд
        var tdGrade = el('td');
        tdGrade.appendChild(el('div', 'cell-main', c.snapshot_position || '—'));
        tr.appendChild(tdGrade);

        // Модуль
        var tdMod = el('td');
        tdMod.appendChild(el('div', 'cell-main', c.snapshot_module || 'Модуль Сертификации'));
        tr.appendChild(tdMod);

        // Сертификат
        var tdName = el('td', 'cell-cert');
        tdName.appendChild(el('div', 'cell-main', c.name || 'Сертификат'));
        if (c.cert_type === 'internal' && c.topic) {
          tdName.appendChild(el('div', 'cell-sub', 'Профиль: ' + c.topic));
        }
        tr.appendChild(tdName);

        // Даты
        var tdDates = el('td');
        var expRaw = String(c.expires_at || '').trim();
        tdDates.appendChild(el('div', 'cell-main', fmtDateRange(c.issued_at, expRaw) || '—'));

        // подсказка по сроку: бессрочный / истекает скоро
        var nowTs = Date.now();
        var expTs = parseExpiry(expRaw);
        var horizonTs = nowTs + 30 * 24 * 60 * 60 * 1000;
        if (!expRaw) {
          var subP = el('div', 'cell-sub');
          subP.appendChild(el('span', 'badge badge--meta badge--meta-perpetual', 'Бессрочный'));
          tdDates.appendChild(subP);
        } else if (expTs && expTs >= nowTs && expTs <= horizonTs && c.status !== 'expired') {
          tr.classList.add('row--expiring');
          var subS = el('div', 'cell-sub');
          subS.appendChild(el('span', 'badge badge--meta badge--meta-soon', 'Истекает скоро'));
          tdDates.appendChild(subS);
        } else if ((c.status === 'expired') || (expTs && expTs < nowTs)) {
          tr.classList.add('row--expired');
        }

        tr.appendChild(tdDates);

        // Статус
        var tdSt = el('td');
        var st = teamStatusBadge(c);
        tdSt.appendChild(el('span', 'badge ' + st.cls, st.text));
        tr.appendChild(tdSt);

        // Оценка
        var tdGr = el('td');
        var canQuick = (c.cert_type === 'internal' && c.workflow_status === 'pending_exam' && isCurrentExaminer(c));
        if (canQuick) {
          var wrap = el('div', 'quick-grade');
          ['Золото', 'Серебро', 'Бронза', 'Не сдан'].forEach(function (g) {
            var btn = el('button', 'grade-btn', g);
            btn.type = 'button';
            btn.classList.add(g === 'Золото' ? 'grade-btn--gold' : g === 'Серебро' ? 'grade-btn--silver' : g === 'Бронза' ? 'grade-btn--bronze' : 'grade-btn--fail');
            btn.addEventListener('click', function (e) {
              e.stopPropagation();
              postQuickExam(c.id, g, btn);
            });
            wrap.appendChild(btn);
          });
          tdGr.appendChild(wrap);
        } else {
          tdGr.appendChild(el('div', 'cell-main', teamGradeText(c)));
          if (c.cert_type === 'internal' && c.workflow_status === 'pending_exam') {
            var who = c.required_examiner_name ? ('Экзаменатор: ' + c.required_examiner_name) : '';
            if (who) tdGr.appendChild(el('div', 'cell-sub', who));
          }
        }
        tr.appendChild(tdGr);
        // Actions
        var tdAct = el('td', 'cell-actions');
        if (teamCanRevoke) {
          if (c.workflow_status === 'revoked') {
            var btnUn = el('button', 'btn btn--xs btn--outline', 'Снять отзыв');
            btnUn.type = 'button';
            btnUn.addEventListener('click', function (e) {
              e.stopPropagation();
              if (!confirm('Снять отзыв сертификата №' + c.id + '?')) return;
              postUnrevoke(c.id, btnUn);
            });
            tdAct.appendChild(btnUn);
          } else {
            var btnRev = el('button', 'btn btn--xs btn--danger', 'Отозвать');
            btnRev.type = 'button';
            btnRev.addEventListener('click', function (e) {
              e.stopPropagation();
              var reason = prompt('Причина отзыва сертификата №' + c.id + ':', '');
              reason = (reason || '').trim();
              if (!reason) return;
              postRevoke(c.id, reason, btnRev);
            });
            tdAct.appendChild(btnRev);
          }
        } else {
          tdAct.appendChild(el('span', 'cell-muted', ''));
        }
        tr.appendChild(tdAct);

        teamTableBody.appendChild(tr);
      });
    }

    function loadMy() {
      return fetch('/api/certificates', { credentials: 'same-origin' })
        .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
        .then(function (data) { myAll = (data && data.items) || []; renderMy(myAll); })
        .catch(function () {
          myAll = []; renderMy([]);
          if (myEmpty) {
            myEmpty.style.display = 'block';
            myEmpty.textContent = 'Не удалось загрузить список сертификатов.';
          }
        });
    }

    function loadRequests() {
      return fetch('/api/certificates/requests', { credentials: 'same-origin' })
        .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
        .then(function (data) { renderRequests((data && data.items) || []); })
        .catch(function () {
          renderRequests([]);
          if (reqEmpty) {
            reqEmpty.style.display = 'block';
            reqEmpty.textContent = 'Не удалось загрузить запросы.';
          }
        });
    }

    function loadTeam() {
      if (!teamTableBody) return Promise.resolve();
      return fetch('/api/certificates/team', { credentials: 'same-origin' })
        .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
        .then(function (data) {
          teamAll = (data && data.items) || [];
          teamCanRevoke = !!(data && data.can_revoke);
          teamScopeText = (data && data.scope) || '';

          if (teamEmpty) {
            teamEmpty.style.display = 'none';
            teamEmpty.textContent = '';
          }

          buildTeamFilterOptions();
          renderTeam();
        })
        .catch(function () {
          teamAll = [];
          teamCanRevoke = false;
          teamScopeText = '';
          setExportEnabled(false);
          if (teamTableBody) teamTableBody.innerHTML = '';
          if (teamTableWrap) teamTableWrap.style.display = 'none';
          if (teamTableEmpty) teamTableEmpty.style.display = 'none';
          if (teamScopeHint) teamScopeHint.style.display = 'none';
          if (teamEmpty) {
            teamEmpty.style.display = 'block';
            teamEmpty.textContent = 'Не удалось загрузить список.';
          }
        });
    }

    function loadAll() {
      return fetchMe().then(function (me) {
        cachedMe = me;
        return Promise.all([loadMy(), loadRequests(), loadTeam()]);
      });
    }

    function syncAddFormUI() {
      if (!addForm) return;
      var t = addForm.querySelector('input[name=\"cert_type\"]:checked');
      var isInternal = t && t.value === 'internal';
      if (topicField) topicField.style.display = isInternal ? 'block' : 'none';
      if (examHint) {
        if (!isInternal) {
          examHint.style.display = 'none';
          examHint.textContent = '';
          return;
        }
        fetchMe().then(function (me) {
          var text = 'После заполнения появится отметка “необходимо сдать экзамен”.';
          if (me && me.manager_id) {
            text = 'Экзамен будет сдавать у непосредственного руководителя.';
          }
          examHint.textContent = text;
          examHint.style.display = 'block';
        });
      }
    }

    function syncPerpetualUI() {
      if (!expiresField || !perpetualAdd) return;
      var checked = !!perpetualAdd.checked;
      expiresField.style.display = checked ? 'none' : 'block';
      var expInput = expiresField.querySelector('input[name=\"expires_at\"]');
      if (expInput) expInput.required = !checked;
      if (checked && expInput) expInput.value = '';
    }

    function setActiveTab(key) {
      tabBtns.forEach(function (b) {
        var active = b.getAttribute('data-tab') === key;
        b.classList.toggle('tab--active', active);
        b.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      tabPanels.forEach(function (p) {
        var active = p.getAttribute('data-tabpanel') === key;
        p.classList.toggle('tab-panel--active', active);
      });

      try { localStorage.setItem('cert_tab', key); } catch (e) {}
    }

    // Tabs binding
    tabBtns.forEach(function (b) {
      b.addEventListener('click', function () {
        var key = b.getAttribute('data-tab');
        setActiveTab(key);
      });
    });

    // restore filters for "Мои сертификаты"
    syncMyFilterUIFromStorage();
    var myFilterInputs = [myShowInternal, myShowExternal, myShowValid, myShowPending, myShowPassed, myShowFailed, myShowRevoked, myShowExpired].filter(Boolean);
    myFilterInputs.forEach(function (inp) {
      inp.addEventListener('change', function () {
        saveMyFilters();
        renderMy(myAll);
      });
    });

    // restore tab
    var savedTab = null;
    try { savedTab = localStorage.getItem('cert_tab'); } catch (e) {}
    if (savedTab === 'team') setActiveTab('team');
    else setActiveTab('my');

    // Team filter bindings
    if (teamSearch) teamSearch.addEventListener('input', function () { renderTeam(); });
    if (teamFilter) teamFilter.addEventListener('change', function () { renderTeam(); });
    if (teamModuleFilter) teamModuleFilter.addEventListener('change', function () { renderTeam(); });
    if (teamGradeFilter) teamGradeFilter.addEventListener('change', function () { renderTeam(); });
    if (teamExpiryFilter) teamExpiryFilter.addEventListener('change', function () { renderTeam(); });
    if (exportTeamCsvBtn) exportTeamCsvBtn.addEventListener('click', function () { exportTeamCSV(); });

    bindTeamSorting();

    // Клик по карточке открывает сертификат (чтобы не целиться в заголовок)
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t) return;
      // не перехватываем клики по интерактивным элементам
      if (t.closest && t.closest('a,button,input,select,textarea,label')) return;
      var card = t.closest ? t.closest('.cert-card--clickable') : null;
      if (!card) return;
      var cid = (card.dataset && card.dataset.certId) ? card.dataset.certId : null;
      if (!cid) return;
      window.location.href = '/certificate/' + encodeURIComponent(cid);
    });

    // open add modal
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        // добавлять можно из любой вкладки — переключаем на "Мои"
        setActiveTab('my');
        openModal(addModal, addErr, addForm);
        if (perpetualAdd) perpetualAdd.checked = true;
        syncPerpetualUI();
        syncAddFormUI();
      });
    }

    if (addForm) {
      addForm.addEventListener('change', function (e) {
        var t = e.target;
        if (t && t.name === 'cert_type') {
          syncAddFormUI();
        }
      });

      if (perpetualAdd) perpetualAdd.addEventListener('change', function(){ syncPerpetualUI(); });

      addForm.addEventListener('submit', function (e) {
        e.preventDefault();
        if (addErr) addErr.textContent = '';

        var name = addForm.querySelector('input[name=\"name\"]').value.trim();
        var issued_at = addForm.querySelector('input[name=\"issued_at\"]').value.trim();
        var is_perpetual = perpetualAdd ? !!perpetualAdd.checked : false;
        var expires_at = is_perpetual ? '' : addForm.querySelector('input[name=\"expires_at\"]').value.trim();
        var certTypeEl = addForm.querySelector('input[name=\"cert_type\"]:checked');
        var cert_type = certTypeEl ? certTypeEl.value : 'external';
        var topicEl = addForm.querySelector('select[name=\"topic\"]');
        var topic = topicEl ? topicEl.value : '';

        if (!name || !issued_at) {
          if (addErr) addErr.textContent = 'Заполните название и дату выдачи.';
          return;
        }
        if (!is_perpetual && !expires_at) {
          if (addErr) addErr.textContent = 'Укажите срок годности или включите бессрочность.';
          return;
        }

        var payload = { name: name, issued_at: issued_at, expires_at: expires_at, is_perpetual: is_perpetual, cert_type: cert_type };
        if (cert_type === 'internal') payload.topic = topic;

        fetch('/api/certificates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(payload)
        })
          .then(function (r) {
            return r.json().then(function (data) { return { ok: r.ok, data: data }; });
          })
          .then(function (res) {
            if (!res.ok) {
              var msg = (res.data && (res.data.detail || res.data.message)) || 'Ошибка при сохранении';
              throw new Error(msg);
            }
            closeModal(addModal, addErr, addForm);
            loadAll();
          })
          .catch(function (err) {
            if (addErr) addErr.textContent = err.message || 'Ошибка';
          });
      });
    }

    // exam form
    if (examForm) {
      examForm.addEventListener('submit', function (e) {
        e.preventDefault();
        if (examErr) examErr.textContent = '';
        var cert_id = examForm.querySelector('input[name=\"cert_id\"]').value.trim();
        var grade = examForm.querySelector('select[name=\"exam_grade\"]').value.trim();
        var exam_date = examForm.querySelector('input[name=\"exam_date\"]').value.trim();
        if (!cert_id) return;

        fetch('/api/certificates/' + encodeURIComponent(cert_id) + '/exam', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ exam_grade: grade, exam_date: exam_date })
        })
          .then(function (r) {
            return r.json().then(function (data) { return { ok: r.ok, data: data }; });
          })
          .then(function (res) {
            if (!res.ok) {
              var msg = (res.data && (res.data.detail || res.data.message)) || 'Ошибка';
              throw new Error(msg);
            }
            closeModal(examModal, examErr, examForm);
            loadAll();
          })
          .catch(function (err) {
            if (examErr) examErr.textContent = err.message || 'Ошибка';
          });
      });
    }

    // revoke form
    if (revokeForm) {
      revokeForm.addEventListener('submit', function (e) {
        e.preventDefault();
        if (revokeErr) revokeErr.textContent = '';
        var cert_id = revokeForm.querySelector('input[name=\"cert_id\"]').value.trim();
        var reason = revokeForm.querySelector('textarea[name=\"reason\"]').value.trim();
        if (!cert_id) return;

        fetch('/api/certificates/' + encodeURIComponent(cert_id) + '/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ reason: reason })
        })
          .then(function (r) {
            return r.json().then(function (data) { return { ok: r.ok, data: data }; });
          })
          .then(function (res) {
            if (!res.ok) {
              var msg = (res.data && (res.data.detail || res.data.message)) || 'Ошибка';
              throw new Error(msg);
            }
            closeModal(revokeModal, revokeErr, revokeForm);
            loadAll();
          })
          .catch(function (err) {
            if (revokeErr) revokeErr.textContent = err.message || 'Ошибка';
          });
      });
    }

    bindModalClose(addModal, addErr, addForm);
    bindModalClose(examModal, examErr, examForm);
    bindModalClose(revokeModal, revokeErr, revokeForm);

    loadAll();
  }

  function initCertificateDetail() {
    var root = document.getElementById('certDetailRoot');
    if (!root) return;

    var certId = root.dataset ? root.dataset.certId : null;
    var shareUrl = root.dataset ? root.dataset.shareUrl : '';
    var canExam = root.dataset && root.dataset.canExam === '1';
    var canHr = root.dataset && root.dataset.canHr === '1';
    var certType = (root.dataset && root.dataset.certType) ? root.dataset.certType : 'external';

    var btnCopy = document.getElementById('copyShareLinkBtn');
    if (btnCopy) {
      btnCopy.addEventListener('click', function(){
        try {
          if (navigator && navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(shareUrl);
        } catch (e) {}
      });
    }

    function todayISO() {
      var t = new Date();
      var yyyy = t.getFullYear();
      var mm = String(t.getMonth() + 1).padStart(2, '0');
      var dd = String(t.getDate()).padStart(2, '0');
      return yyyy + '-' + mm + '-' + dd;
    }

    function openModal(modalEl, errEl, formEl) {
      if (!modalEl) return;
      modalEl.classList.add('open');
      modalEl.setAttribute('aria-hidden', 'false');
      if (errEl) errEl.textContent = '';
      if (formEl) {
        var issued = formEl.querySelector('input[name=\"issued_at\"]');
        if (issued && !issued.value) issued.value = root.dataset.issuedAt || todayISO();
        var exp = formEl.querySelector('input[name=\"expires_at\"]');
        if (exp && !exp.value) exp.value = root.dataset.expiresAt || '';
        var examDate = formEl.querySelector('input[name=\"exam_date\"]');
        if (examDate && !examDate.value) examDate.value = todayISO();
      }
    }
    function closeModal(modalEl, errEl, formEl) {
      if (!modalEl) return;
      modalEl.classList.remove('open');
      modalEl.setAttribute('aria-hidden', 'true');
      if (formEl) formEl.reset();
      if (errEl) errEl.textContent = '';
    }
    function bindModalClose(modalEl, errEl, formEl) {
      if (!modalEl) return;
      modalEl.addEventListener('click', function(e){
        var t = e.target;
        if (t && t.getAttribute && t.getAttribute('data-close') === '1') closeModal(modalEl, errEl, formEl);
      });
      document.addEventListener('keydown', function(e){
        if (e.key === 'Escape') closeModal(modalEl, errEl, formEl);
      });
    }

    // exam modal
    var examModal = document.getElementById('examModal');
    var examForm = document.getElementById('examForm');
    var examErr = document.getElementById('examFormError');

    // revoke modal
    var revokeModal = document.getElementById('revokeModal');
    var revokeForm = document.getElementById('revokeForm');
    var revokeErr = document.getElementById('revokeFormError');

    // edit modal (HR)
    var editModal = document.getElementById('editModal');
    var editForm = document.getElementById('editForm');
    var editErr = document.getElementById('editFormError');
    var editTopicField = document.getElementById('editTopicField');
    var editExpiresField = document.getElementById('editExpiresField');
    var editPerpetual = document.getElementById('isPerpetualEdit');

    function syncEditPerpetual() {
      if (!editExpiresField || !editPerpetual) return;
      var checked = !!editPerpetual.checked;
      editExpiresField.style.display = checked ? 'none' : 'block';
      var expInput = editExpiresField.querySelector('input[name=\"expires_at\"]');
      if (expInput) expInput.required = !checked;
      if (checked && expInput) expInput.value = '';
    }

    if (editPerpetual) editPerpetual.addEventListener('change', syncEditPerpetual);

    var btnExam = document.getElementById('detailExamBtn');
    if (btnExam && canExam) {
      btnExam.addEventListener('click', function(){
        if (!examForm || !examModal) return;
        examForm.querySelector('input[name=\"cert_id\"]').value = String(certId);
        openModal(examModal, examErr, examForm);
      });
    }

    var btnRevoke = document.getElementById('detailRevokeBtn');
    if (btnRevoke && canHr) {
      btnRevoke.addEventListener('click', function(){
        if (!revokeForm || !revokeModal) return;
        revokeForm.querySelector('input[name=\"cert_id\"]').value = String(certId);
        openModal(revokeModal, revokeErr, revokeForm);
      });
    }

    var btnUnrev = document.getElementById('detailUnrevokeBtn');
    if (btnUnrev && canHr) {
      btnUnrev.addEventListener('click', function(){
        fetch('/api/certificates/' + encodeURIComponent(certId) + '/unrevoke', { method: 'POST', credentials: 'same-origin' })
          .then(function(r){ return r.json().then(function(d){ return {ok:r.ok,data:d};});})
          .then(function(res){ if(!res.ok) throw new Error((res.data && res.data.detail) || 'Ошибка'); window.location.reload(); })
          .catch(function(){ window.location.reload(); });
      });
    }

    var btnEdit = document.getElementById('detailEditBtn');
    if (btnEdit && canHr) {
      btnEdit.addEventListener('click', function(){
        if (!editForm || !editModal) return;
        // prefill from dataset
        editForm.querySelector('input[name=\"name\"]').value = root.dataset.name || '';
        editForm.querySelector('input[name=\"issued_at\"]').value = root.dataset.issuedAt || todayISO();
        editForm.querySelector('input[name=\"expires_at\"]').value = root.dataset.expiresAt || '';
        if (editPerpetual) editPerpetual.checked = !(root.dataset.expiresAt || '').trim();
        if (editTopicField) editTopicField.style.display = certType === 'internal' ? 'block' : 'none';
        if (certType === 'internal') {
          var sel = editForm.querySelector('select[name=\"topic\"]');
          if (sel) sel.value = root.dataset.topic || sel.value;
        }
        syncEditPerpetual();
        openModal(editModal, editErr, editForm);
      });
    }

    // exam submit
    if (examForm) {
      examForm.addEventListener('submit', function(e){
        e.preventDefault();
        if (examErr) examErr.textContent = '';
        var grade = examForm.querySelector('select[name=\"exam_grade\"]').value;
        var dateVal = examForm.querySelector('input[name=\"exam_date\"]').value;
        fetch('/api/certificates/' + encodeURIComponent(certId) + '/exam', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ exam_grade: grade, exam_date: dateVal })
        }).then(function(r){ return r.json().then(function(d){ return {ok:r.ok,data:d};});})
          .then(function(res){ if(!res.ok) throw new Error((res.data && res.data.detail) || 'Ошибка'); window.location.reload(); })
          .catch(function(err){ if (examErr) examErr.textContent = err.message || 'Ошибка'; });
      });
    }

    // revoke submit
    if (revokeForm) {
      revokeForm.addEventListener('submit', function(e){
        e.preventDefault();
        if (revokeErr) revokeErr.textContent = '';
        var reason = revokeForm.querySelector('textarea[name=\"reason\"]').value.trim();
        fetch('/api/certificates/' + encodeURIComponent(certId) + '/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ reason: reason })
        }).then(function(r){ return r.json().then(function(d){ return {ok:r.ok,data:d};});})
          .then(function(res){ if(!res.ok) throw new Error((res.data && res.data.detail) || 'Ошибка'); window.location.reload(); })
          .catch(function(err){ if (revokeErr) revokeErr.textContent = err.message || 'Ошибка'; });
      });
    }

    // edit submit
    if (editForm) {
      editForm.addEventListener('submit', function(e){
        e.preventDefault();
        if (editErr) editErr.textContent = '';
        var name = editForm.querySelector('input[name=\"name\"]').value.trim();
        var issued = editForm.querySelector('input[name=\"issued_at\"]').value.trim();
        var isPerp = editPerpetual ? !!editPerpetual.checked : false;
        var exp = isPerp ? '' : editForm.querySelector('input[name=\"expires_at\"]').value.trim();
        var topic = '';
        if (certType === 'internal') {
          var sel = editForm.querySelector('select[name=\"topic\"]');
          topic = sel ? sel.value : '';
        }
        if (!name || !issued) {
          if (editErr) editErr.textContent = 'Заполните название и дату выдачи.';
          return;
        }
        if (!isPerp && !exp) {
          if (editErr) editErr.textContent = 'Укажите срок годности или включите бессрочность.';
          return;
        }
        var payload = { name: name, issued_at: issued, expires_at: exp, is_perpetual: isPerp, topic: topic };
        fetch('/api/certificates/' + encodeURIComponent(certId) + '/edit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(payload)
        }).then(function(r){ return r.json().then(function(d){ return {ok:r.ok,data:d};});})
          .then(function(res){ if(!res.ok) throw new Error((res.data && res.data.detail) || 'Ошибка'); window.location.reload(); })
          .catch(function(err){ if (editErr) editErr.textContent = err.message || 'Ошибка'; });
      });
    }

    bindModalClose(examModal, examErr, examForm);
    bindModalClose(revokeModal, revokeErr, revokeForm);
    bindModalClose(editModal, editErr, editForm);
  }

  initProfileMenu();
  initCertification();
  initCertificateDetail();
})();