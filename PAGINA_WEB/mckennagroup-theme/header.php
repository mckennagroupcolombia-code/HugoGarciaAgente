<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php bloginfo('charset'); ?>">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="profile" href="https://gmpg.org/xfn/11">
<?php wp_head(); ?>
</head>

<body <?php body_class(); ?>>
<?php wp_body_open(); ?>

<!-- ===================================================
     ANNOUNCEMENT BAR
     =================================================== -->
<div class="announcement-bar">
    🌿 Materias primas farmacéuticas y cosméticas de calidad certificada &nbsp;|&nbsp;
    <strong>Bogotá, Colombia</strong> &nbsp;·&nbsp;
    Atención: Lun – Vie 8:00 – 17:30
</div>

<!-- ===================================================
     HEADER
     =================================================== -->
<header id="site-header" role="banner">
    <div class="container">
        <div class="header-inner">

            <!-- Logo -->
            <?php echo mckg_get_logo_html(); ?>

            <!-- Navegación principal -->
            <nav class="main-nav" role="navigation" aria-label="<?php esc_attr_e('Menú principal', 'mckennagroup'); ?>">
                <?php
                wp_nav_menu([
                    'theme_location' => 'primary',
                    'container'      => false,
                    'fallback_cb'    => function() {
                        // Menú de fallback con links de WooCommerce
                        echo '<ul>';
                        echo '<li><a href="' . esc_url(home_url('/')) . '">Inicio</a></li>';
                        if (function_exists('wc_get_page_id')) {
                            $shop_id = wc_get_page_id('shop');
                            if ($shop_id > 0) {
                                echo '<li><a href="' . esc_url(get_permalink($shop_id)) . '">Tienda</a></li>';
                            }
                        }
                        echo '<li><a href="' . esc_url(home_url('/nosotros')) . '">Nosotros</a></li>';
                        echo '<li><a href="' . esc_url(home_url('/contacto')) . '">Contacto</a></li>';
                        echo '</ul>';
                    },
                ]);
                ?>
            </nav>

            <!-- Búsqueda -->
            <?php get_search_form(); ?>

            <!-- Acciones header -->
            <div class="header-actions">
                <?php if (function_exists('WC')): ?>
                <a href="<?php echo esc_url(wc_get_cart_url()); ?>" class="header-cart-btn" aria-label="Carrito">
                    <i class="ph ph-shopping-cart"></i>
                    <?php $count = WC()->cart ? WC()->cart->get_cart_contents_count() : 0; ?>
                    <?php if ($count > 0): ?>
                    <span class="cart-count"><?php echo esc_html($count); ?></span>
                    <?php endif; ?>
                </a>
                <?php endif; ?>

                <a href="<?php echo esc_url(wc_get_account_endpoint_url('dashboard')); ?>"
                   class="btn btn-outline btn-sm" aria-label="Mi cuenta">
                    <i class="ph ph-user"></i>
                    Mi Cuenta
                </a>
            </div>

            <!-- Hamburger (mobile) -->
            <button class="menu-toggle" aria-label="Abrir menú" aria-expanded="false">
                <span></span>
                <span></span>
                <span></span>
            </button>

        </div>
    </div>

    <!-- Menú móvil -->
    <div class="mobile-menu" id="mobile-menu" hidden>
        <div class="container">
            <?php
            wp_nav_menu([
                'theme_location' => 'primary',
                'container'      => false,
                'menu_class'     => 'mobile-nav-list',
                'fallback_cb'    => false,
            ]);
            ?>
        </div>
    </div>
</header>

<div id="page-content" class="site-content">
