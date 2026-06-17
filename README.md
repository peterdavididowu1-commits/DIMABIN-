# His Grace Nursery & Primary School - Responsive Web Portal

A premium, highly responsive, mobile-first school website and administrative portal tailored for **His Grace Nursery and Primary School** in Agbugburu Village, Abeokuta, Ogun State.

This repository is optimized for instant deployment across major hosting platforms with zero external build systems, servers, or database requirements.

---

## 🚀 Key Features

- **100% Mobile First & Responsive Responsive Design**: Styled utilizing fluid grids, container queries, and Material 3 design tokens. Looks beautiful on mobile, foldables, tablets, and wide desktop views. Natively supports responsive sidebar navigation. Natively supports horizontal layout adjustments.
- **Unified Academic Pages (6 Distinct Screens)**: Including high fidelity interactive grids, full-form validations, academic structures and access points:
  - **Home**: Introducing school features and central statistics, general values, Christian perspectives.
  - **About Us**: Detailing the school foundations, heritage milestones, detailed Mission, Vision, and official operating hours.
  - **Admissions**: Step-by-step registration guidelines, diagnostic assessment criteria, and an **Interactive Smart Online Admission Form**.
  - **Academics**: Laying out early childhood Montessori and core primary curriculums, termly continuous assessment structures.
  - **Contact Us**: Displaying direct campus helpline directories, physical landmarks, coordinates, and an **Interactive Direct Message Form**.
  - **Student Portal Login**: Branded simulated access center for Pupils, Guardians, and Instructors.
- **Dynamic Action Interactivity (`main.js`)**: Dynamic hamburger navigation toggles, smooth active page menu indicators, interactive Lightbox dialog popups inside galleries (clicking a thumbnail renders descriptive detail cards seamlessly), and clean client-side input validations with visual processing states.
- **Polished Visual Assets**: Standard vector academic emblems (the official HGS crest), actual campus and classroom activity imagery properly structured in relative directories.

---

## 🎯 Direct Deployment Steps

This site is composed of standard client-side assets (**HTML5, CSS3, JavaScript**). It is fully static and incredibly lightweight.

### 1. GitHub Pages (FREE Hosting)
1. Push this repository to any public GitHub repository.
2. In your repository settings, navigate to the **Pages** tab (under the left sidebar).
3. Under **Build and deployment**, set the source to **Deploy from a branch**.
4. Choose your branch (e.g. `main` or `master`) and folder (select `/` root folder).
5. Click **Save**. Your site will be online at `https://<your-username>.github.io/<your-repo-name>/` in less than two minutes!

### 2. Netlify (Instant Drag-and-Drop)
1. Create a free account on [Netlify](https://www.netlify.com/).
2. Drag and drop the root of this project folder directly onto the **Netlify Drop** panel, or link your GitHub repository.
3. If linking GitHub:
   - **Build Command**: Leave *blank* (no command needed).
   - **Publish Directory**: Set to `.` (root directory) or leave *blank*.
4. Netlify will deploy your site instantly and provide a custom testing subdomain.

### 3. Vercel (Instant CLI / Git Integration)
1. Log in to [Vercel](https://vercel.com/) and click **Add New** > **Project**.
2. Import your GitHub repository.
3. Under **Project Settings**:
   - **Framework Preset**: Choose **Other** or **Vanilla HTML/CSS**.
   - **Build and Output Settings**: Leave completely blank.
4. Click **Deploy**. Vercel launches the production site automatically with high-performance edge networks.

---

## 🗄️ Project File Structure

```text
├── assets/
│   ├── css/
│   │   └── style.css       # Core custom layout & design system
│   ├── js/
│   │   └── main.js         # Navigation and Form validation interaction
│   └── images/
│       ├── logo.jpg        # HGS Crest Logo SVG-like imagery
│       ├── building.jpg    # HGS Central Academic Block
│       ├── classroom.jpg   # Bright library classroom session
│       └── banner.jpg      # Broad background banner
├── index.html              # Home Entrance
├── about.html              # His Grace Background & School Hours
├── admissions.html         # Smart Enrollment Portal & Forms
├── academics.html          # Classes & Curriculum Layouts
├── contact.html            # Help Desk & Message Forms
├── login.html              # Student Portal access login
├── metadata.json           # Platform configurations
└── README.md               # Detailed instruction sheet
```

---

## 📐 Material 3 Color Reference (HGS Palette)

- **Primary (HGS Dark Blue)**: `#1e3a8a` (Security, academic standards, faith-centric growth)
- **Secondary (HGS Forest Green)**: `#15803d` (Vitality, youth potential, character foundation)
- **Accent (HGS Amber Gold)**: `#f59e0b` (Greatness paths, shining beacons, grace)
- **Slate Light Background**: `#f8fafc` (Modern, clean, readability-first layout spaces)

Developed with absolute craftsmanship for **His Grace School, Agbugburu Village, Abeokuta**. 🌟
