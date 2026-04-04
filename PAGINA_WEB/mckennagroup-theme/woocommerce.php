<?php
/**
 * Plantilla contenedora de WooCommerce
 */
get_header();

// Hero de tienda
if (is_shop()):
?>
<section class="page-hero">
    <div class="container">
        <span class="page-hero-badge">Catálogo Completo</span>
        <h1><?php woocommerce_page_title(); ?></h1>
        <p>Materias primas farmacéuticas y cosméticas de calidad certificada. Despachos a todo Colombia.</p>
    </div>
</section>
<?php
elseif (is_product_category()):
    $cat = get_queried_object();
?>
<section class="page-hero">
    <div class="container">
        <span class="page-hero-badge">Categoría</span>
        <h1><?php echo esc_html($cat->name); ?></h1>
        <?php if ($cat->description): ?>
        <p><?php echo esc_html($cat->description); ?></p>
        <?php endif; ?>
    </div>
</section>
<?php
else:
?>
<section class="page-hero">
    <div class="container">
        <span class="page-hero-badge">Tienda</span>
        <h1><?php woocommerce_page_title(); ?></h1>
    </div>
</section>
<?php
endif;

// Breadcrumbs
if (function_exists('woocommerce_breadcrumb')):
?>
<div style="background:var(--green-ultra);border-bottom:1px solid var(--green-pale);">
    <div class="container">
        <?php woocommerce_breadcrumb(); ?>
    </div>
</div>
<?php endif; ?>

<div class="container">
    <div class="shop-layout">

        <!-- Sidebar -->
        <aside class="shop-sidebar">
            <?php if (is_active_sidebar('shop-sidebar')): ?>
                <?php dynamic_sidebar('shop-sidebar'); ?>
            <?php else: ?>
                <div class="sidebar-widget">
                    <h3>Categorías</h3>
                    <?php
                    $cats = get_terms([
                        'taxonomy'   => 'product_cat',
                        'hide_empty' => true,
                        'parent'     => 0,
                    ]);
                    if (!is_wp_error($cats) && $cats):
                    ?>
                    <ul style="padding:0;">
                        <?php foreach ($cats as $cat): ?>
                        <li style="padding:8px 0;border-bottom:1px solid var(--green-pale);">
                            <a href="<?php echo esc_url(get_term_link($cat)); ?>"
                               style="color:var(--text-mid);font-size:0.875rem;font-weight:600;display:flex;justify-content:space-between;align-items:center;transition:color var(--transition);">
                                <?php echo esc_html($cat->name); ?>
                                <span style="color:var(--text-muted);font-size:0.7rem;font-weight:700;background:var(--green-pale);padding:2px 8px;border-radius:20px;"><?php echo esc_html($cat->count); ?></span>
                            </a>
                        </li>
                        <?php endforeach; ?>
                    </ul>
                    <?php endif; ?>
                </div>

                <?php
                if (class_exists('WC_Widget_Price_Filter')) {
                    the_widget('WC_Widget_Price_Filter', [], [
                        'before_widget' => '<div class="sidebar-widget">',
                        'after_widget'  => '</div>',
                        'before_title'  => '<h3>',
                        'after_title'   => '</h3>',
                    ]);
                }
                ?>
            <?php endif; ?>
        </aside>

        <!-- Contenido principal -->
        <main class="shop-main" role="main">
            <?php woocommerce_content(); ?>
        </main>

    </div>
</div>

<?php get_footer(); ?>
