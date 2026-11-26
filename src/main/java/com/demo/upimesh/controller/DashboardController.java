package com.demo.upimesh.controller;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;

@Controller
public class DashboardController {

    @GetMapping("/")
    public String home() {
        return "dashboard";
    }

    @GetMapping({"/app", "/app/"})
    public String webApp() {
        return "forward:/app/index.html";
    }

    @GetMapping("/bob")
    public String receiver(@RequestParam(defaultValue = "bob@demo") String vpa) {
        return "redirect:/app/#/receive?vpa=" + vpa;
    }
}
