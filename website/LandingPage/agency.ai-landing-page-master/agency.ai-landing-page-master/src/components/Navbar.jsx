import React, { useState } from "react";
import assets from "../assets/assets";
import ThemeToggleBtn from "./ThemeToggleBtn";
import { motion } from "framer-motion";

const Navbar = ({ theme, setTheme }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: -50 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="flex justify-between items-center px-4 sm:px-12 lg:px-24 xl:px-40 py-4 sticky top-0 z-20 backdrop-blur-xl font-medium bg-white/50 dark:bg-gray-900/70"
    >
      {/* Logo */}
      <img
        src={theme === "dark" ? assets.logo_dark : assets.logo}
        alt="logo"
        className="w-32 sm:w-40"
      />

      {/* Sidebar / Menu Links */}
      <div
        className={`text-gray-700 dark:text-white sm:text-sm fixed sm:static top-0 bottom-0 right-0 h-full sm:h-auto flex flex-col sm:flex-row sm:items-center gap-5 sm:bg-transparent transition-all duration-300
          ${sidebarOpen ? "w-60 pl-10 bg-primary text-white pt-20" : "w-0 overflow-hidden sm:w-auto sm:pl-0 sm:pt-0"}`}
      >
        {/* Close Button (Mobile Only) */}
        <img
          src={assets.close_icon}
          alt="close"
          className="w-5 absolute right-4 top-4 sm:hidden cursor-pointer"
          onClick={() => setSidebarOpen(false)}
        />

        <a onClick={() => setSidebarOpen(false)} href="#" className="sm:hover:border-b">
          Home
        </a>
        <a onClick={() => setSidebarOpen(false)} href="#services" className="sm:hover:border-b">
          Services
        </a>
        <a onClick={() => setSidebarOpen(false)} href="#our-work" className="sm:hover:border-b">
          Our Work
        </a>
        <a onClick={() => setSidebarOpen(false)} href="#contact-us" className="sm:hover:border-b">
          Contact Us
        </a>
      </div>

      {/* Right Side Controls */}
      <div className="flex items-center gap-2 sm:gap-4">
        {/* Theme Toggle */}
        <ThemeToggleBtn theme={theme} setTheme={setTheme} />

        {/* Mobile Menu Button */}
        <img
          src={theme === "dark" ? assets.menu_icon_dark : assets.menu_icon}
          alt="menu"
          onClick={() => setSidebarOpen(true)}
          className="w-8 sm:hidden cursor-pointer"
        />

        {/* Contact Button (hidden on small screens) */}
        <a
          href="#contact-us"
          className="text-sm hidden sm:flex items-center gap-2 bg-primary text-white px-6 py-2 rounded-full cursor-pointer hover:scale-105 transition-transform"
        >
          Contact <img src={assets.arrow_icon} width={14} alt="arrow" />
        </a>
      </div>
    </motion.div>
  );
};

export default Navbar;
