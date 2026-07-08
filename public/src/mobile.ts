import { $ } from './utils.js';

const SWIPE_THRESHOLD = 50;
const MOBILE_BREAKPOINT = 768;

let touchStartX = 0;
let touchStartY = 0;
let isSwiping = false;

export function initMobileGestures(): void {
  if (!isMobile()) return;

  initSidebarSwipe();
  initConversationSwipe();
  initBackdropClose();
}

function isMobile(): boolean {
  return window.innerWidth <= MOBILE_BREAKPOINT || 'ontouchstart' in window;
}

function initSidebarSwipe(): void {
  const sidebar = $('.sidebar');
  const chatArea = document.querySelector('.chat-area') as HTMLElement;
  const menuBtn = $('.menuBtn');
  const backdrop = $('.sidebar-backdrop') as HTMLElement;

  if (!sidebar || !chatArea) return;

  // Swipe from left edge to open sidebar
  chatArea.addEventListener('touchstart', (e) => {
    const touch = e.touches[0];
    if (touch.clientX < 20) {
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      isSwiping = true;
    }
  }, { passive: true });

  chatArea.addEventListener('touchmove', (e) => {
    if (!isSwiping) return;
    const touch = e.touches[0];
    const deltaX = touch.clientX - touchStartX;
    const deltaY = Math.abs(touch.clientY - touchStartY);

    // Only horizontal swipe
    if (deltaY > 30) {
      isSwiping = false;
      return;
    }

    if (deltaX > 0 && deltaX < 300) {
      sidebar.style.transform = `translateX(${deltaX - 300}px)`;
    }
  }, { passive: true });

  chatArea.addEventListener('touchend', (e) => {
    if (!isSwiping) return;
    isSwiping = false;

    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - touchStartX;

    sidebar.style.transform = '';

    if (deltaX > SWIPE_THRESHOLD) {
      openSidebar();
    } else {
      closeSidebar();
    }
  }, { passive: true });

  // Swipe from sidebar to close
  sidebar.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    isSwiping = true;
  }, { passive: true });

  sidebar.addEventListener('touchend', (e) => {
    if (!isSwiping) return;
    isSwiping = false;

    const deltaX = e.changedTouches[0].clientX - touchStartX;
    if (deltaX < -SWIPE_THRESHOLD) {
      closeSidebar();
    }
  }, { passive: true });

  // Menu button
  if (menuBtn) {
    menuBtn.addEventListener('click', () => {
      if (sidebar.classList.contains('open')) {
        closeSidebar();
      } else {
        openSidebar();
      }
    });
  }

  // Backdrop click
  if (backdrop) {
    backdrop.addEventListener('click', closeSidebar);
  }
}

function openSidebar(): void {
  const sidebar = $('.sidebar');
  const backdrop = $('.sidebar-backdrop') as HTMLElement;

  sidebar?.classList.add('open');
  if (backdrop) {
    backdrop.classList.add('visible');
    backdrop.style.display = 'block';
  }
}

function closeSidebar(): void {
  const sidebar = $('.sidebar');
  const backdrop = $('.sidebar-backdrop') as HTMLElement;

  sidebar?.classList.remove('open');
  if (backdrop) {
    backdrop.classList.remove('visible');
    setTimeout(() => {
      backdrop.style.display = 'none';
    }, 300);
  }
}

function initConversationSwipe(): void {
  const conversationList = $('.conversationList');
  if (!conversationList) return;

  conversationList.addEventListener('touchstart', (e) => {
    const item = (e.target as HTMLElement).closest('.conversation-item');
    if (!item) return;

    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    isSwiping = true;

    // Reset any previously swiped items
    conversationList.querySelectorAll('.conversation-item.swiped').forEach((el) => {
      el.classList.remove('swiped');
    });
  }, { passive: true });

  conversationList.addEventListener('touchmove', (e) => {
    if (!isSwiping) return;

    const item = (e.target as HTMLElement).closest('.conversation-item');
    if (!item) return;

    const touch = e.touches[0];
    const deltaX = touch.clientX - touchStartX;
    const deltaY = Math.abs(touch.clientY - touchStartY);

    // Only horizontal swipe
    if (deltaY > 30) {
      isSwiping = false;
      return;
    }

    if (deltaX < -30) {
      item.classList.add('swiped');
    } else if (deltaX > 30) {
      item.classList.remove('swiped');
    }
  }, { passive: true });

  conversationList.addEventListener('touchend', (e) => {
    if (!isSwiping) return;
    isSwiping = false;

    const item = (e.target as HTMLElement).closest('.conversation-item');
    if (!item) return;

    const deltaX = e.changedTouches[0].clientX - touchStartX;

    if (deltaX < -SWIPE_THRESHOLD) {
      item.classList.add('swiped');
    } else if (deltaX > SWIPE_THRESHOLD) {
      item.classList.remove('swiped');
    }
  }, { passive: true });

  // Close swiped items when tapping elsewhere
  document.addEventListener('touchstart', (e) => {
    if (!(e.target as HTMLElement).closest('.conversation-item')) {
      conversationList.querySelectorAll('.conversation-item.swiped').forEach((el) => {
        el.classList.remove('swiped');
      });
    }
  }, { passive: true });
}

function initBackdropClose(): void {
  // Create backdrop element if it doesn't exist
  let backdrop = $('.sidebar-backdrop') as HTMLElement;
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.className = 'sidebar-backdrop';
    backdrop.style.display = 'none';
    document.body.appendChild(backdrop);
  }
}

export function isMobileDevice(): boolean {
  return isMobile();
}
