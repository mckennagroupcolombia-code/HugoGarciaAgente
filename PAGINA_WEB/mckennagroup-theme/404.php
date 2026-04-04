<?php get_header(); ?>

<div class="container">
    <div class="page-404">
        <div>
            <div class="error-code">404</div>
            <h1 style="margin-bottom:12px;">Página no encontrada</h1>
            <p style="color:var(--text-muted);margin-bottom:32px;font-size:1.125rem;">
                El recurso que buscas no existe o fue movido.
            </p>
            <div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap;">
                <a href="<?php echo esc_url(home_url('/')); ?>" class="btn btn-primary btn-lg">
                    <i class="ph ph-house"></i> Ir al Inicio
                </a>
                <?php if (function_exists('wc_get_page_id')): ?>
                <a href="<?php echo esc_url(get_permalink(wc_get_page_id('shop'))); ?>" class="btn btn-outline btn-lg">
                    <i class="ph ph-storefront"></i> Ver Tienda
                </a>
                <?php endif; ?>
            </div>
        </div>
    </div>
</div>

<?php get_footer(); ?>
