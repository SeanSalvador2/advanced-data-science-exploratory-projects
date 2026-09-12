---
course: TDL
lecture: 5
title: Certified Defenses
date: 2026-09-15
deck: "[[deck.pdf]]"
generated: 2026-09-12T08:04:52.087Z
---

# Lecture 05: Certified Defenses

## Slide 1: Certified Defenses  [[deck.pdf#page=1]]

- Admin: the problem set due Friday now runs to Monday, there is no class a week from Thursday because he is at a workshop, and office hours move to Wednesday two to four. `00:14`
- Almost all of today comes from the Cohen, Rosenfeld and Kolter paper, which is on the reading list. [[deck.pdf#page=1&selection=0,0,2,11|slide]] `00:53`
- He placed this lecture as the point where the course stops playing whack-a-mole with empirical attacks and starts proving things instead. [[deck.pdf#page=1&selection=0,0,2,11|slide]] `01:06`

Terms on this slide
- **certified defense**: A defense that comes with a proof that no perturbation inside a stated radius can change the model's prediction. The proof holds against every attack in that radius, not only the ones that were tried. Intuition: It replaces the arms race of attack and patch with a guarantee you can state once and rely on. Here: The subject of this lecture; the deck builds it from randomized smoothing and states the trade-off on the summary slide.

## Slide 2: Randomized smoothing  [[deck.pdf#page=2]]

- You are not defending the classifier you trained but a blurred copy of it, and the blurring is what buys the guarantee: a tiny push cannot cross a smeared decision boundary. [[deck.pdf#page=2&selection=0,0,2,39|slide]] `02:43`
- He called randomized smoothing the same trick as label smoothing in a different costume: different literature, same instinct not to trust the sharp thing. [[deck.pdf#page=2&selection=0,0,0,20|slide]] `03:16`
- The noisy copies are a batch of about a hundred thousand per input, so prediction runs four orders of magnitude slower than a forward pass, which is why certified numbers are rare in papers. [[deck.pdf#page=2&selection=9,0,9,44|slide]] `03:33`
- **me:** slide says noise at prediction time but he keeps saying you also train with it - same sigma both places [[deck.pdf#page=2&selection=2,0,4,44|slide]] `03:40`
- The slide only fixes when the noise level is chosen; he added that the base classifier must itself be trained on noisy inputs at that same sigma, or smoothing a clean-trained model gives garbage. [[deck.pdf#page=2&selection=2,0,4,44|slide]] `04:06`
- The margin becomes a radius only because the vote is a probability and probabilities under a Gaussian carry a geometry; the next slide makes that exchange rate explicit. [[deck.pdf#page=2&selection=10,0,10,34|slide]] `04:40`
- Drawing more noise samples tightens the estimate of the vote probability but does not change it, so more samples cannot buy a bigger radius. [[deck.pdf#page=2&selection=10,0,14,4|slide]] `04:56`

Terms on this slide
- **randomized smoothing**: A defense that answers with the majority vote of the classifier's predictions on Gaussian-noised copies of the input. The margin of that vote is converted into a certified radius. Intuition: Voting over noise blurs the decision boundary, so a small perturbation cannot flip the answer. Here: Presented as three steps: add noise at prediction time, take a majority vote, turn the margin into a radius.
- **Gaussian noise**: Noise drawn from a normal distribution and added to the input before each prediction. Intuition: It is the randomness the whole method is built on: the guarantee comes from the shape of the Gaussian, not from the classifier. Here: Added at prediction time, with its level fixed during training.
- **certification time**: The moment the certificate is computed for an input, after training has finished. Intuition: The slide insists the noise level is not a knob you may turn once you know the input, or the guarantee would be chosen after seeing the question. Here: Contrasted with training time: the noise level belongs to training, not to certification.
- **majority vote**: The class predicted most often across the noisy copies of one input. Intuition: Many noisy looks at the same input, answered by a show of hands, so one unlucky look cannot decide the answer. Here: Taken over the noisy copies produced by the Gaussian noise on the line above.
- **vote margin**: The gap between the winning class's share of the votes and the runner-up's. Intuition: It measures how decisive the vote was, and a decisive vote takes more perturbation to overturn. Here: The quantity that becomes the radius: bigger margin, bigger certificate.
- **certified radius**: The size of the region around an input inside which no perturbation can change the smoothed prediction. Intuition: It is the number the whole method exists to produce: how far an attacker may move before the guarantee stops. Here: Read off the vote margin here, and computed from the inverse Gaussian CDF on the next slide.

## Slide 3: The certificate  [[deck.pdf#page=3]]

- The vote probability is the chance the base classifier returns the top class on one single noise draw, not the majority over many draws. [[deck.pdf#page=3&selection=8,0,8,40|slide]] `05:49`
- **me:** why Phi inverse and not a tail bound? [[deck.pdf#page=3&selection=8,0,8,40|slide]] `06:20`
  - answered: Neyman-Pearson makes the worst case a half space, and the distance from a Gaussian's centre to a half space of a given mass is exactly Phi inverse, so it is exact rather than a bound. `07:23`
- Phi inverse rather than a Hoeffding tail bound because Neyman-Pearson makes the worst case a half space, and the distance from a Gaussian's centre to a half space of given mass is exactly Phi inverse. [[deck.pdf#page=3&selection=8,0,8,40|slide]] `06:27`
- A tail bound would be true but loose, and loose here means throwing away radius you had already earned. [[deck.pdf#page=3&selection=8,0,8,40|slide]] `07:24`
- The certificate is an ell two guarantee even though the slide states the threat model in the ell infinity norm, because Phi inverse of a Gaussian mass is a Euclidean distance. [[deck.pdf#page=3&selection=7,0,8,40|slide]] `07:43`
- Pushed far enough the trade-off ends in collapse: the base classifier can no longer see anything and the vote probability falls to chance. [[deck.pdf#page=3&selection=4,0,6,1|slide]] `08:02`
- The paper sweeps sigma at 0.25, 0.5 and 1, and the 0.5 curve is the one everybody ends up plotting. [[deck.pdf#page=3&selection=4,0,6,1|slide]] `08:21`
- You can convert, since an ell two ball of radius r contains an ell infinity ball of radius r over root d, but that root d is brutal once d is a real image. [[deck.pdf#page=3&selection=7,0,7,11|slide]] `13:00`
- When a paper quotes an ell infinity radius, check whether it converted or smoothed with a different distribution: uniform or Laplace noise gives an ell one or ell infinity certificate directly. [[deck.pdf#page=3&selection=7,0,7,11|slide]] `13:20`
- He said the deck is wrong here: the noise scale is sigma, the standard deviation, not the variance sigma squared, and he will fix the slide before posting it. [[deck.pdf#page=3&selection=4,0,6,1|slide]] `14:20`

Terms on this slide
- **sigma squared**: The variance of the Gaussian noise added to each input; its square root, sigma, is the noise scale. Intuition: One knob for the whole method: more noise certifies a larger radius and predicts less accurately. Here: Printed σ² and called the noise scale; fixed at training time, per the previous slide.
- **ell infinity norm**: The largest coordinate-wise difference between the perturbed input x prime and the original input x. Intuition: It is the strict reading of a small perturbation: no single pixel may move by more than the budget. Here: The threat model on this slide is stated in the ell infinity norm, bounded by epsilon.
- **epsilon**: The perturbation budget: the largest ell infinity change an attacker is allowed to make to the input. Intuition: It is the size of the box the attacker may move inside, and the number a certificate has to beat to be useful. Here: Written ε, on the right-hand side of the constraint.
- **Phi inverse**: The inverse of the standard Gaussian cumulative distribution function, applied to the vote probability to obtain the radius. Intuition: It is the exchange rate between a probability and a distance, and it is a Gaussian one because the noise is Gaussian. Here: Printed Φ⁻¹ and read as the source of the radius formula; the vote probability comes from the majority vote of the previous slide.
- **certified radius**: The size of the region around an input inside which no perturbation can change the smoothed prediction. Intuition: It is the number the whole method exists to produce: how far an attacker may move before the guarantee stops. Here: Computed here from Φ⁻¹ of the vote probability rather than from the margin directly.

## Slide 4: Two views  [[deck.pdf#page=4]]

- He tied the left column back to lecture two, where a published defense fell to a transfer attack in about fifteen minutes: empirical robustness is a claim about the attacks somebody happened to run. [[deck.pdf#page=4&selection=2,0,6,20|slide]] `09:20`
- Exam hint: shown a table of robust accuracies and asked what is wrong with it, the answer he wants is that the attack was fixed and the defense tuned against it. [[deck.pdf#page=4&selection=2,0,6,20|slide]] `10:00`
- **me:** does a certified radius survive fine tuning the base classifier? [[deck.pdf#page=4&selection=8,0,13,25|slide]] `10:15`
- If a certified number ever beats an empirical number on the same model the evaluation is broken; certified numbers come out smaller every single time. [[deck.pdf#page=4&selection=8,0,14,20|slide]] `10:20`
- He reframed the small certified number as a floor you can stand on, against the empirical number as a ceiling that may not exist at all. [[deck.pdf#page=4&selection=8,0,14,20|slide]] `10:40`
- Certified accuracy only means something at a stated radius, so find the radius column first when you read a table; papers do publish certified accuracies without one. [[deck.pdf#page=4&selection=12,0,13,25|slide]] `11:00`

Terms on this slide
- **empirical robustness**: Robustness measured by running attacks against the model and reporting what it survives. Intuition: Cheap and optimistic: it says the attacks you tried failed, which a better attack can undo tomorrow. Here: The left column of this slide, set against the certified column.
- **certified robustness**: Robustness proved for a radius: no perturbation inside it can change the prediction. Intuition: Expensive and pessimistic, but the number cannot be taken away by a smarter attack later. Here: The right column of this slide; what randomized smoothing delivers.
- **certified radius**: The size of the region around an input inside which no perturbation can change the smoothed prediction. Intuition: It is the number the whole method exists to produce: how far an attacker may move before the guarantee stops. Here: Described here as the thing no attack can cross, at the cost of smaller reported numbers.

## Slide 6: Summary  [[deck.pdf#page=6]]

- The guarantee degrades with dimension: at fixed accuracy the certified radius shrinks roughly like one over root d in ell infinity, tolerable on CIFAR and embarrassing on ImageNet. [[deck.pdf#page=6&selection=2,0,5,52|slide]] `15:23`
- Certified robustness on high-resolution images is a research area rather than a tool, so his answer on certifying a production model is no, for sample cost first and dimension second. [[deck.pdf#page=6&selection=2,0,4,47|slide]] `16:09`
- Where it does earn its keep is small inputs with high stakes: tabular medical data and control signals, where d is small and being wrong is expensive. [[deck.pdf#page=6&selection=2,0,4,47|slide]] `16:55`
- The guarantee is per input, not a property of the model: two images of the same class can have wildly different radii, which certified accuracy at one radius hides. [[deck.pdf#page=6&selection=5,0,5,52|slide]] `17:18`
- Next week is the training side, SmoothAdv and the consistency regulariser; read sections three and four of the Cohen paper first and skip the appendix. `18:04`

Terms on this slide
- **certified defense**: A defense that comes with a proof that no perturbation inside a stated radius can change the model's prediction. The proof holds against every attack in that radius, not only the ones that were tried. Intuition: It replaces the arms race of attack and patch with a guarantee you can state once and rely on. Here: Closed here on its cost: the guarantee is paid for in accuracy.
- **certified radius**: The size of the region around an input inside which no perturbation can change the smoothed prediction. Intuition: It is the number the whole method exists to produce: how far an attacker may move before the guarantee stops. Here: The scope of the guarantee: every attack inside the radius, none outside it.

## Open questions

- does a certified radius survive fine tuning the base classifier? (slide 4, `10:15`)
- Does the certificate still mean anything if the attacker knows sigma and can pick the input? (slide 6, `18:50`)
