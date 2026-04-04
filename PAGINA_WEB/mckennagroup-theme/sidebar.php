<?php
if (is_active_sidebar('shop-sidebar') && (is_woocommerce() || is_shop() || is_product_category())):
    dynamic_sidebar('shop-sidebar');
elseif (is_active_sidebar('blog-sidebar')):
    dynamic_sidebar('blog-sidebar');
endif;
