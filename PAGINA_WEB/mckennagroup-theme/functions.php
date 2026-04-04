<?php
/**
 * McKenna Group Theme — functions.php
 */

defined('ABSPATH') || exit;

/* =========================================================
   SETUP
   ========================================================= */
function mckg_setup() {
    load_theme_textdomain('mckennagroup', get_template_directory() . '/languages');

    add_theme_support('title-tag');
    add_theme_support('post-thumbnails');
    add_theme_support('html5', ['search-form','comment-form','comment-list','gallery','caption','style','script']);
    add_theme_support('customize-selective-refresh-widgets');
    add_theme_support('responsive-embeds');
    add_theme_support('align-wide');

    // WooCommerce
    add_theme_support('woocommerce', [
        'thumbnail_image_width' => 600,
        'gallery_thumbnail_image_width' => 100,
    ]);
    add_theme_support('wc-product-gallery-zoom');
    add_theme_support('wc-product-gallery-lightbox');
    add_theme_support('wc-product-gallery-slider');

    // Menús
    register_nav_menus([
        'primary'   => __('Menú Principal', 'mckennagroup'),
        'footer'    => __('Menú Footer', 'mckennagroup'),
        'secondary' => __('Menú Secundario', 'mckennagroup'),
    ]);
}
add_action('after_setup_theme', 'mckg_setup');

/* =========================================================
   ENQUEUE SCRIPTS & STYLES
   ========================================================= */
function mckg_enqueue_assets() {
    // Google Fonts
    wp_enqueue_style(
        'mckg-fonts',
        'https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400&display=swap',
        [],
        null
    );

    // Iconos (Phosphor Icons CDN — libre)
    wp_enqueue_style(
        'mckg-icons',
        'https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css',
        [],
        '2.1.1'
    );

    // Estilos del tema
    wp_enqueue_style(
        'mckg-main',
        get_template_directory_uri() . '/assets/css/main.css',
        ['mckg-fonts'],
        wp_get_theme()->get('Version')
    );

    // style.css del tema (requerido por WP)
    wp_enqueue_style(
        'mckennagroup-style',
        get_stylesheet_uri(),
        ['mckg-main'],
        wp_get_theme()->get('Version')
    );

    // JS principal
    wp_enqueue_script(
        'mckg-main',
        get_template_directory_uri() . '/assets/js/main.js',
        [],
        wp_get_theme()->get('Version'),
        true
    );

    wp_localize_script('mckg-main', 'mckgAjax', [
        'url'   => admin_url('admin-ajax.php'),
        'nonce' => wp_create_nonce('mckg_nonce'),
        'cart'  => function_exists('WC') ? WC()->cart->get_cart_contents_count() : 0,
    ]);
}
add_action('wp_enqueue_scripts', 'mckg_enqueue_assets');

/* =========================================================
   WIDGETS
   ========================================================= */
function mckg_register_widgets() {
    $sidebars = [
        ['name' => 'Sidebar Tienda',   'id' => 'shop-sidebar'],
        ['name' => 'Sidebar Blog',     'id' => 'blog-sidebar'],
        ['name' => 'Footer Col 1',     'id' => 'footer-1'],
        ['name' => 'Footer Col 2',     'id' => 'footer-2'],
        ['name' => 'Footer Col 3',     'id' => 'footer-3'],
    ];
    foreach ($sidebars as $s) {
        register_sidebar([
            'name'          => $s['name'],
            'id'            => $s['id'],
            'before_widget' => '<div class="sidebar-widget">',
            'after_widget'  => '</div>',
            'before_title'  => '<h3>',
            'after_title'   => '</h3>',
        ]);
    }
}
add_action('widgets_init', 'mckg_register_widgets');

/* =========================================================
   WOOCOMMERCE HOOKS
   ========================================================= */

// Quitar sidebar de WooCommerce (usamos el nuestro)
remove_action('woocommerce_sidebar', 'woocommerce_get_sidebar', 10);

// Envolver contenido de producto en div
add_action('woocommerce_before_shop_loop_item', function() {
    echo '<div class="product-inner">';
}, 5);
add_action('woocommerce_after_shop_loop_item', function() {
    echo '</div>';
}, 15);

// Abrir / cerrar wrap de imagen
add_action('woocommerce_before_shop_loop_item_title', function() {
    echo '<div class="product-thumb">';
    // Badge "Nuevo" si tiene menos de 30 días
    global $product;
    $created = $product ? strtotime($product->get_date_created()) : 0;
    if ($created && (time() - $created) < (30 * DAY_IN_SECONDS)) {
        echo '<span class="product-badge">Nuevo</span>';
    }
    // Badge "Agotado"
    if ($product && !$product->is_in_stock()) {
        echo '<span class="product-badge" style="background:var(--text-muted)">Agotado</span>';
    }
}, 5);
add_action('woocommerce_before_shop_loop_item_title', function() {
    echo '</div><div class="product-info-wrap">';
}, 15);
add_action('woocommerce_after_shop_loop_item', function() {
    echo '</div>';
}, 5);

// Mostrar SKU en grid
add_action('woocommerce_before_shop_loop_item_title', function() {
    global $product;
    $sku = $product ? $product->get_sku() : '';
    if ($sku) {
        echo '<div class="product-sku">Ref: ' . esc_html($sku) . '</div>';
    }
}, 12);

// Columnas de productos
add_filter('loop_shop_columns', function() { return 4; });
add_filter('loop_shop_per_page', function() { return 24; });

/* =========================================================
   IMAGEN DEL LOGO
   ========================================================= */
function mckg_get_logo_html(string $classes = ''): string {
    $logo_id = get_theme_mod('custom_logo');
    $logo_url = $logo_id ? wp_get_attachment_image_url($logo_id, 'full') : '';
    $site_name = get_bloginfo('name');
    $home_url  = home_url('/');

    $html  = '<a href="' . esc_url($home_url) . '" class="site-logo ' . esc_attr($classes) . '">';
    if ($logo_url) {
        $html .= '<img src="' . esc_url($logo_url) . '" alt="' . esc_attr($site_name) . '">';
    } else {
        $html .= '<div class="brand-text">'
               . esc_html($site_name)
               . '<span>Materias Primas</span>'
               . '</div>';
    }
    $html .= '</a>';
    return $html;
}

/* =========================================================
   CART FRAGMENT AJAX
   ========================================================= */
add_filter('woocommerce_add_to_cart_fragments', function($fragments) {
    $count = WC()->cart->get_cart_contents_count();
    $fragments['.cart-count'] = '<span class="cart-count">' . $count . '</span>';
    return $fragments;
});

/* =========================================================
   EXCERPT LENGTH
   ========================================================= */
add_filter('excerpt_length', fn() => 20);
add_filter('excerpt_more', fn() => '…');

/* =========================================================
   CUSTOM SEARCH FORM
   ========================================================= */
add_filter('get_search_form', function() {
    return sprintf(
        '<form role="search" method="get" class="header-search" action="%s">
            <i class="ph ph-magnifying-glass search-icon"></i>
            <input type="search" name="s" placeholder="%s" value="%s">
        </form>',
        esc_url(home_url('/')),
        esc_attr__('Buscar productos...', 'mckennagroup'),
        esc_attr(get_search_query())
    );
});

/* =========================================================
   BODY CLASS
   ========================================================= */
add_filter('body_class', function($classes) {
    if (is_shop() || is_product_category() || is_product_tag()) {
        $classes[] = 'woocommerce-shop-page';
    }
    return $classes;
});

/* =========================================================
   TÍTULO PÁGINA TIENDA
   ========================================================= */
add_filter('woocommerce_show_page_title', '__return_false');

/* =========================================================
   ELEMENTOR: declarar soporte de áreas
   ========================================================= */
add_action('elementor/theme/register_locations', function($manager) {
    $manager->register_all_core_location();
});
