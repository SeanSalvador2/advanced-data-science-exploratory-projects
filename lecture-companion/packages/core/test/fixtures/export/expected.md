---
course: TDL
lecture: 5
title: Certified Defenses
date: 2026-09-15
deck: "[[deck.pdf]]"
generated: 2026-09-15T20:14:00.000-04:00
---

# Lecture 05: Certified Defenses

## Slide 1: Certified Defenses  [[deck.pdf#page=1]]

Terms on this slide
- **certified defense**: A defense that comes with a proof. Intuition: A guarantee instead of an arms race.

## Slide 2: The certificate  [[deck.pdf#page=2]]

- **me:** why Phi inverse and not a tail bound? [[deck.pdf#page=2&selection=5,0,5,29|slide]] `13:41`
  - answered: Neyman-Pearson makes the worst case a half space, so the distance is exact. `14:32`
- The noise scale is chosen once, at training time, and never touched again at certification time. [[deck.pdf#page=2&selection=3,0,5,29|slide]] `13:50`
- \# radii written [[like this]\] are the ones the paper reports `75:12`

Terms on this slide
- **sigma**: The standard deviation of the Gaussian noise. Intuition: One knob trading accuracy for radius. Here: Fixed at training time.

## Open questions

- Why does the certificate degrade with dimension? (slide 2, `21:03`)
- Is sigma public? (slide 3)
