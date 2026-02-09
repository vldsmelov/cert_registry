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
    if (!issued || !expires) return '';
    return issued + ' — ' + expires;
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
    var reqList = document.getElementById('reqList');
    var reqEmpty = document.getElementById('reqEmpty');

    // team
    var teamInternalList = document.getElementById('teamInternalList');
    var teamExternalList = document.getElementById('teamExternalList');
    var teamEmpty = document.getElementById('teamEmpty');
    var teamInternalEmpty = document.getElementById('teamInternalEmpty');
    var teamExternalEmpty = document.getElementById('teamExternalEmpty');
    var teamSearch = document.getElementById('teamSearch');
    var teamFilter = document.getElementById('teamFilter');
    var teamScopeHint = document.getElementById('teamScopeHint');

    // modals (add)
    var addModal = document.getElementById('certModal');
    var addForm = document.getElementById('certForm');
    var addErr = document.getElementById('certFormError');
    var topicField = document.getElementById('topicField');
    var examHint = document.getElementById('examHint');

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
    var teamAll = [];
    var teamCanRevoke = false;
    var teamScopeText = '';

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

    function renderMy(items) {
      var all = items || [];

      if (!all.length) {
        if (myEmpty) {
          myEmpty.style.display = 'block';
          myEmpty.textContent = 'Пока нет сертификатов. Нажмите “+ Добавить сертификат”, чтобы добавить.';
        }
        if (myInternalEmpty) myInternalEmpty.style.display = 'none';
        if (myExternalEmpty) myExternalEmpty.style.display = 'none';
        clearList(myInternalList);
        clearList(myExternalList);
        return;
      }

      if (myEmpty) myEmpty.style.display = 'none';

      var internal = all.filter(function (c) { return c.cert_type === 'internal'; });
      var external = all.filter(function (c) { return c.cert_type !== 'internal'; });

      renderGrouped(myInternalList, myInternalEmpty, internal, { emptyText: 'Нет внутренних сертификатов.', preview: true });
      renderGrouped(myExternalList, myExternalEmpty, external, { emptyText: 'Нет внешних сертификатов.', preview: true });
    }

    function renderRequests(items) {
      if (!reqList) return;
      renderCards(reqList, reqEmpty, items, { emptyText: 'Нет запросов на экзамен.', variant: 'cert-card--request', showEmployee: true, canExam: true, me: cachedMe });
    }

    function applyTeamFilters(items) {
      var q = safeLower(teamSearch && teamSearch.value);
      var f = (teamFilter && teamFilter.value) || 'all';

      return (items || []).filter(function (c) {
        if (f === 'pending_exam' && c.workflow_status !== 'pending_exam') return false;
        if (f === 'passed' && c.workflow_status !== 'passed') return false;
        if (f === 'failed' && c.workflow_status !== 'failed') return false;
        if (f === 'revoked' && c.workflow_status !== 'revoked') return false;
        if (f === 'valid' && c.status !== 'valid') return false;
        if (f === 'expired' && c.status !== 'expired') return false;

        if (!q) return true;
        var hay = safeLower(c.name) + ' ' + safeLower(c.topic) + ' ' + safeLower(c.snapshot_full_name) + ' ' + safeLower(c.snapshot_position) + ' ' + safeLower(c.snapshot_manager_name);
        return hay.indexOf(q) !== -1;
      });
    }

    function renderTeam() {
      if (!teamInternalList && !teamExternalList) return;
      var filtered = applyTeamFilters(teamAll);

      if (teamScopeHint) {
        var msg = teamScopeText || '';
        if (teamCanRevoke) msg += (msg ? ' • ' : '') + 'Вы можете отзывать сертификаты.';
        teamScopeHint.textContent = msg;
        teamScopeHint.style.display = msg ? 'block' : 'none';
      }

      if (teamEmpty) teamEmpty.style.display = 'none';

      var internal = filtered.filter(function (c) { return c.cert_type === 'internal'; });
      var external = filtered.filter(function (c) { return c.cert_type !== 'internal'; });

      var emptyInternal = teamCanRevoke ? 'Нет внутренних сертификатов в модуле.' : 'Нет внутренних сертификатов сотрудников.';
      var emptyExternal = teamCanRevoke ? 'Нет внешних сертификатов в модуле.' : 'Нет внешних сертификатов сотрудников.';

      renderGrouped(teamInternalList, teamInternalEmpty, internal, { emptyText: emptyInternal, showEmployee: true, canRevoke: teamCanRevoke, canExam: true, me: cachedMe });
      renderGrouped(teamExternalList, teamExternalEmpty, external, { emptyText: emptyExternal, showEmployee: true, canRevoke: teamCanRevoke, canExam: false, me: cachedMe });
    }

    function loadMy() {
      return fetch('/api/certificates', { credentials: 'same-origin' })
        .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
        .then(function (data) { renderMy((data && data.items) || []); })
        .catch(function () {
          renderMy([]);
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
      if (!teamInternalList && !teamExternalList) return Promise.resolve();
      return fetch('/api/certificates/team', { credentials: 'same-origin' })
        .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
        .then(function (data) {
          teamAll = (data && data.items) || [];
          teamCanRevoke = !!(data && data.can_revoke);
          teamScopeText = (data && data.scope) || '';
          renderTeam();
        })
        .catch(function () {
          teamAll = [];
          teamCanRevoke = false;
          teamScopeText = '';
          renderTeam();
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

    // restore tab
    var savedTab = null;
    try { savedTab = localStorage.getItem('cert_tab'); } catch (e) {}
    if (savedTab === 'team') setActiveTab('team');
    else setActiveTab('my');

    // Team filter bindings
    if (teamSearch) teamSearch.addEventListener('input', function () { renderTeam(); });
    if (teamFilter) teamFilter.addEventListener('change', function () { renderTeam(); });

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

      addForm.addEventListener('submit', function (e) {
        e.preventDefault();
        if (addErr) addErr.textContent = '';

        var name = addForm.querySelector('input[name=\"name\"]').value.trim();
        var issued_at = addForm.querySelector('input[name=\"issued_at\"]').value.trim();
        var expires_at = addForm.querySelector('input[name=\"expires_at\"]').value.trim();
        var certTypeEl = addForm.querySelector('input[name=\"cert_type\"]:checked');
        var cert_type = certTypeEl ? certTypeEl.value : 'external';
        var topicEl = addForm.querySelector('select[name=\"topic\"]');
        var topic = topicEl ? topicEl.value : '';

        var payload = { name: name, issued_at: issued_at, expires_at: expires_at, cert_type: cert_type };
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

  initProfileMenu();
  initCertification();
})();