import React from 'react';
import { NavLink } from 'react-router-dom';

export function TabBar() {
  return (
    <nav aria-label="Primary navigation" className="tabbar">
      <NavLink
        to="/"
        end
        className={({ isActive }) => `tab-item ${isActive ? 'tab-item--active' : ''}`}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M22 2L11 13" />
          <path d="M22 2L15 22L11 13L2 9L22 2Z" />
        </svg>
        <span>Send</span>
      </NavLink>

      <NavLink
        to="/history"
        className={({ isActive }) => `tab-item ${isActive ? 'tab-item--active' : ''}`}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 3" />
        </svg>
        <span>History</span>
      </NavLink>

      <NavLink
        to="/receive"
        className={({ isActive }) => `tab-item ${isActive ? 'tab-item--active' : ''}`}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 3v12" />
          <path d="M7 10l5 5 5-5" />
          <path d="M5 20h14" />
        </svg>
        <span>Receive</span>
      </NavLink>
    </nav>
  );
}
